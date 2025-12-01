import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { Enrollment } from '../entities/enrollment.entity';
import { SubjectGroup } from '../entities/subject-group.entity';
import { EnrollmentStatus } from '../enum/enrollment-status.enum';
import { EnrollmentValidationService } from './enrollment-validation.service';
import { EnrollmentRequestEvent } from '../dto/events/enrollment-request.event';

@Injectable()
export class EnrollmentWorkerService implements OnModuleInit {
    private readonly logger = new Logger(EnrollmentWorkerService.name);
    private isProcessing = false;

    constructor(
        @InjectRepository(Enrollment)
        private readonly enrollmentRepository: Repository<Enrollment>,
        @InjectRepository(SubjectGroup)
        private readonly subjectGroupRepository: Repository<SubjectGroup>,
        private readonly dataSource: DataSource,
        private readonly validationService: EnrollmentValidationService,
    ) { }

    onModuleInit() {
        this.logger.log('EnrollmentWorkerService initialized');
    }

    /**
     * Procesa una solicitud de inscripción desde Kafka
     * Valida reglas de negocio y actualiza el estado a CONFIRMED o REJECTED
     * @param event - Evento de solicitud de inscripción
     */
    async processEnrollmentRequest(event: EnrollmentRequestEvent): Promise<void> {
        const { enrollmentId, studentId, periodId, subjectGroupIds } = event;

        this.logger.log(`Processing enrollment request ${enrollmentId} for student ${studentId}`);

        try {
            // Validar que el enrollment existe y está en estado PENDING
            const enrollment = await this.enrollmentRepository.findOne({
                where: { id: enrollmentId }
            });

            if (!enrollment) {
                this.logger.error(`Enrollment ${enrollmentId} not found`);
                return;
            }

            if (enrollment.status !== EnrollmentStatus.PENDING) {
                this.logger.warn(`Enrollment ${enrollmentId} is not in PENDING status, skipping`);
                return;
            }

            // Ejecutar validaciones
            const spotsValidation = await this.validationService.validateSpots(subjectGroupIds);
            if (!spotsValidation.valid) {
                await this.rejectEnrollment(enrollmentId, spotsValidation.reason!);
                return;
            }

            const scheduleValidation = await this.validationService.validateScheduleConflicts(subjectGroupIds);
            if (!scheduleValidation.valid) {
                await this.rejectEnrollment(enrollmentId, scheduleValidation.reason!);
                return;
            }

            const duplicateValidation = await this.validationService.validateNoDuplicateConfirmed(
                studentId,
                periodId
            );
            if (!duplicateValidation.valid) {
                await this.rejectEnrollment(enrollmentId, duplicateValidation.reason!);
                return;
            }

            // Si todas las validaciones pasan, confirmar la inscripción
            await this.confirmEnrollment(enrollmentId, subjectGroupIds);

        } catch (error) {
            this.logger.error(`Error processing enrollment ${enrollmentId}:`, error);
            await this.rejectEnrollment(
                enrollmentId,
                `Error interno al procesar la inscripción: ${error.message}`
            );
        }
    }

    /**
     * Confirma una inscripción y reduce los cupos atómicamente
     * @param enrollmentId - ID de la inscripción
     * @param subjectGroupIds - IDs de los grupos a inscribir
     */
    private async confirmEnrollment(enrollmentId: number, subjectGroupIds: number[]): Promise<void> {
        await this.dataSource.transaction(async (manager) => {
            // Reducir cupos de cada subject_group con optimistic locking
            for (const subjectGroupId of subjectGroupIds) {
                const subjectGroup = await manager.findOne(SubjectGroup, {
                    where: { id: subjectGroupId },
                    lock: { mode: 'pessimistic_write' } // Lock para evitar race conditions
                });

                if (!subjectGroup) {
                    throw new Error(`Subject group ${subjectGroupId} not found`);
                }

                if (subjectGroup.spots <= 0) {
                    throw new Error(`No spots available for subject group ${subjectGroupId}`);
                }

                // Reducir cupo e incrementar versión
                subjectGroup.spots -= 1;
                await manager.save(subjectGroup);
            }

            // Actualizar enrollment a CONFIRMED
            await manager.update(Enrollment, enrollmentId, {
                status: EnrollmentStatus.CONFIRMED,
                processedAt: new Date(),
                rejectionReason: null,
            });

            this.logger.log(`Enrollment ${enrollmentId} CONFIRMED successfully`);
        });
    }

    /**
     * Rechaza una inscripción con una razón específica
     * @param enrollmentId - ID de la inscripción
     * @param reason - Razón del rechazo
     */
    private async rejectEnrollment(enrollmentId: number, reason: string): Promise<void> {
        await this.enrollmentRepository.update(enrollmentId, {
            status: EnrollmentStatus.REJECTED,
            rejectionReason: reason,
            processedAt: new Date(),
        });

        this.logger.log(`Enrollment ${enrollmentId} REJECTED: ${reason}`);
    }

    /**
     * Reduce cupos de múltiples subject_groups atómicamente con optimistic locking
     * @param subjectGroupIds - IDs de los grupos
     * @deprecated - Usar confirmEnrollment que incluye esta lógica
     */
    private async reduceSpots(subjectGroupIds: number[]): Promise<void> {
        await this.dataSource.transaction(async (manager) => {
            for (const id of subjectGroupIds) {
                const result = await manager
                    .createQueryBuilder()
                    .update(SubjectGroup)
                    .set({
                        spots: () => 'spots - 1',
                    })
                    .where('id = :id', { id })
                    .andWhere('spots > 0')
                    .execute();

                if (result.affected === 0) {
                    throw new Error(`No spots available or concurrent update for group ${id}`);
                }
            }
        });
    }
}
