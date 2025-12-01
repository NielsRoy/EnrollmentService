import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import type { ClientKafkaProxy } from '@nestjs/microservices';
import { Enrollment } from '../entities/enrollment.entity';
import { EnrollmentDetail } from '../entities/enrollment-detail.entity';
import { Period } from '../entities/period.entity';
import { SubjectGroup } from '../entities/subject-group.entity';
import { EnrollmentStatus } from '../enum/enrollment-status.enum';
import { CreateEnrollmentRequestDto } from '../dto/requests/create-enrollment-request.dto';
import { EnrollmentResponseDto, SubjectGroupInfoDto } from '../dto/responses/enrollment-response.dto';
import { EnrollmentStatusResponseDto } from '../dto/responses/enrollment-status-response.dto';
import { EnrollmentRequestEvent } from '../dto/events/enrollment-request.event';
import { EnrollmentValidationService } from './enrollment-validation.service';
import { KAFKA_SERVICE } from '../config/services';

@Injectable()
export class EnrollmentService {
    private readonly logger = new Logger(EnrollmentService.name);

    constructor(
        @InjectRepository(Enrollment)
        private readonly enrollmentRepository: Repository<Enrollment>,
        @InjectRepository(EnrollmentDetail)
        private readonly enrollmentDetailRepository: Repository<EnrollmentDetail>,
        @InjectRepository(Period)
        private readonly periodRepository: Repository<Period>,
        @InjectRepository(SubjectGroup)
        private readonly subjectGroupRepository: Repository<SubjectGroup>,
        private readonly dataSource: DataSource,
        private readonly validationService: EnrollmentValidationService,
        @Inject(KAFKA_SERVICE)
        private readonly kafkaClient: ClientKafkaProxy,
    ) { }

    /**
     * Crea una solicitud de inscripción con estado PENDING y la publica a Kafka
     * @param dto - Datos de la solicitud de inscripción
     * @returns Enrollment creado con estado PENDING
     */
    async createEnrollmentRequest(dto: CreateEnrollmentRequestDto): Promise<EnrollmentResponseDto> {
        this.logger.log(`Creating enrollment request for student ${dto.studentId}`);

        try {
            // Validar que existe un período activo
            const period = await this.periodRepository.findOne({
                where: { status: 'ACTIVE' }
            });

            if (!period) {
                throw new NotFoundException(`No active period found`);
            }

            const periodId = period.id;
            this.logger.log(`Found active period ${periodId}`);

            // Validar que no existe inscripción CONFIRMED para este estudiante en este período
            const duplicateValidation = await this.validationService.validateNoDuplicateConfirmed(
                dto.studentId,
                periodId
            );

            if (!duplicateValidation.valid) {
                throw new Error(duplicateValidation.reason);
            }

            // Crear enrollment y enrollment_detail en una transacción
            const enrollment = await this.dataSource.transaction(async (manager) => {
                // Crear enrollment con status PENDING
                const newEnrollment = manager.create(Enrollment, {
                    studentId: dto.studentId,
                    period: period,
                    online: dto.online,
                    status: EnrollmentStatus.PENDING,
                    rejectionReason: null,
                    processedAt: null,
                });

                const savedEnrollment = await manager.save(newEnrollment);

                // Crear enrollment_detail para cada subject_group
                const enrollmentDetails = dto.subjectGroupIds.map(subjectGroupId =>
                    manager.create(EnrollmentDetail, {
                        enrollment: savedEnrollment,
                        subjectGroupId: subjectGroupId,
                    })
                );

                await manager.save(enrollmentDetails);

                return savedEnrollment;
            });

            this.logger.log(`Enrollment ${enrollment.id} created with status PENDING`);

            // Publicar evento a Kafka para procesamiento asíncrono
            const event: EnrollmentRequestEvent = {
                enrollmentId: enrollment.id,
                studentId: dto.studentId,
                periodId: periodId,
                subjectGroupIds: dto.subjectGroupIds,
                online: dto.online,
                timestamp: new Date(),
            };

            this.kafkaClient.emit('enrollment-requests', event);
            this.logger.log(`Enrollment request ${enrollment.id} published to Kafka`);

            // Retornar respuesta
            return this.buildEnrollmentResponse(enrollment.id);

        } catch (error) {
            this.logger.error(`Error creating enrollment request: ${error.message}`, error.stack);
            if (error instanceof NotFoundException) {
                throw new RpcException({ status: 404, message: error.message });
            }
            // Check if it's a validation error (custom Error from validation service)
            if (error.message.includes('Ya existe una inscripción') || error.message.includes('Sin cupos') || error.message.includes('Conflicto')) {
                throw new RpcException({ status: 409, message: error.message });
            }

            throw new RpcException({ status: 500, message: `Failed to create enrollment request: ${error.message}` });
        }
    }

    /**
     * Consulta el estado actual de una inscripción (para polling)
     * @param enrollmentId - ID de la inscripción
     * @returns Estado actual de la inscripción
     */
    async getEnrollmentStatus(enrollmentId: number): Promise<EnrollmentStatusResponseDto> {
        const enrollment = await this.enrollmentRepository.findOne({
            where: { id: enrollmentId },
            select: ['id', 'status', 'datetime', 'rejectionReason', 'processedAt']
        });

        if (!enrollment) {
            throw new NotFoundException(`Enrollment with ID ${enrollmentId} not found`);
        }

        return {
            id: enrollment.id,
            status: enrollment.status,
            datetime: enrollment.datetime,
            rejectionReason: enrollment.rejectionReason,
            processedAt: enrollment.processedAt,
        };
    }

    /**
     * Obtiene todas las inscripciones de un estudiante
     * @param studentId - ID del estudiante
     * @param periodId - ID del período (opcional)
     * @returns Array de inscripciones
     */
    async getStudentEnrollments(
        studentId: number,
        periodId?: number
    ): Promise<EnrollmentResponseDto[]> {
        const where: any = { studentId };
        if (periodId) {
            where.period = { id: periodId };
        }

        const enrollments = await this.enrollmentRepository.find({
            where,
            relations: ['period'],
            order: { datetime: 'DESC' }
        });

        return Promise.all(
            enrollments.map(e => this.buildEnrollmentResponse(e.id))
        );
    }

    /**
     * Construye la respuesta completa de una inscripción con información de grupos
     * @param enrollmentId - ID de la inscripción
     * @returns Respuesta completa con información de grupos
     */
    private async buildEnrollmentResponse(enrollmentId: number): Promise<EnrollmentResponseDto> {
        const enrollment = await this.enrollmentRepository.findOne({
            where: { id: enrollmentId },
            relations: ['period', 'period.term', 'enrollmentDetails']
        });

        if (!enrollment) {
            throw new NotFoundException(`Enrollment with ID ${enrollmentId} not found`);
        }

        // Obtener información de los subject_groups
        const subjectGroupIds = enrollment.enrollmentDetails.map(ed => ed.subjectGroupId);

        const subjectGroups = await this.subjectGroupRepository
            .createQueryBuilder('sg')
            .innerJoin('plan_subject', 'ps', 'ps.id = sg."planSubjectId"')
            .innerJoin('subject', 's', 's.id = ps."subjectId"')
            .where('sg.id IN (:...ids)', { ids: subjectGroupIds })
            .select([
                'sg.id AS "subjectGroupId"',
                's.name AS "subjectName"',
                's.code AS "subjectCode"',
                'sg.group AS "group"'
            ])
            .getRawMany<SubjectGroupInfoDto>();

        return {
            id: enrollment.id,
            status: enrollment.status,
            datetime: enrollment.datetime,
            rejectionReason: enrollment.rejectionReason,
            processedAt: enrollment.processedAt,
            period: enrollment.period.number,
            year: enrollment.period.term.year,
            studentId: enrollment.studentId,
            online: enrollment.online,
            subjectGroups: subjectGroups,
        };
    }
}
