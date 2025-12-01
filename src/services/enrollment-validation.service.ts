import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { SubjectGroup } from '../entities/subject-group.entity';
import { GroupSchedule } from '../entities/group-schedule.entity';
import { Enrollment } from '../entities/enrollment.entity';
import { EnrollmentStatus } from '../enum/enrollment-status.enum';

@Injectable()
export class EnrollmentValidationService {
    private readonly logger = new Logger(EnrollmentValidationService.name);

    constructor(
        @InjectRepository(SubjectGroup)
        private readonly subjectGroupRepository: Repository<SubjectGroup>,
        @InjectRepository(GroupSchedule)
        private readonly groupScheduleRepository: Repository<GroupSchedule>,
        @InjectRepository(Enrollment)
        private readonly enrollmentRepository: Repository<Enrollment>,
    ) { }

    /**
     * Valida que todos los subject_group tengan cupos disponibles (spots > 0)
     * @param subjectGroupIds - IDs de los grupos a validar
     * @returns true si todos tienen cupos, false si alguno no tiene
     */
    async validateSpots(subjectGroupIds: number[]): Promise<{ valid: boolean; reason?: string }> {
        const groups = await this.subjectGroupRepository.find({
            where: { id: In(subjectGroupIds) },
            select: ['id', 'spots', 'group', 'planSubjectId']
        });

        if (groups.length !== subjectGroupIds.length) {
            const foundIds = groups.map(g => g.id);
            const missingIds = subjectGroupIds.filter(id => !foundIds.includes(id));
            return {
                valid: false,
                reason: `Grupos no encontrados: ${missingIds.join(', ')}`
            };
        }

        const groupsWithoutSpots = groups.filter(g => g.spots <= 0);

        if (groupsWithoutSpots.length > 0) {
            const groupNames = groupsWithoutSpots.map(g => `Grupo ${g.group} (ID: ${g.id})`).join(', ');
            return {
                valid: false,
                reason: `Sin cupos disponibles en: ${groupNames}`
            };
        }

        return { valid: true };
    }

    /**
     * Valida que no existan conflictos de horario entre los subject_group seleccionados
     * @param subjectGroupIds - IDs de los grupos a validar
     * @returns true si no hay conflictos, false si hay solapamiento de horarios
     */
    async validateScheduleConflicts(subjectGroupIds: number[]): Promise<{ valid: boolean; reason?: string }> {
        // Obtener todos los horarios de los grupos seleccionados
        const schedules = await this.groupScheduleRepository
            .createQueryBuilder('gs')
            .innerJoinAndSelect('gs.schedule', 'schedule')
            .innerJoinAndSelect('gs.subjectGroup', 'sg')
            .where('gs.subjectGroup.id IN (:...ids)', { ids: subjectGroupIds })
            .select([
                'gs.id',
                'gs.day',
                'schedule.beginTime',
                'schedule.endTime',
                'sg.id',
                'sg.group'
            ])
            .getMany();

        // Agrupar por día
        const byDay = new Map<string, Array<{
            beginTime: string;
            endTime: string;
            groupId: number;
            groupName: string;
        }>>();

        for (const gs of schedules) {
            if (!byDay.has(gs.day)) {
                byDay.set(gs.day, []);
            }
            byDay.get(gs.day)!.push({
                beginTime: gs.schedule.beginTime,
                endTime: gs.schedule.endTime,
                groupId: gs.subjectGroup.id,
                groupName: gs.subjectGroup.group
            });
        }

        // Verificar conflictos en cada día
        for (const [day, times] of byDay.entries()) {
            const conflict = this.findTimeConflict(times);
            if (conflict) {
                return {
                    valid: false,
                    reason: `Conflicto de horario el ${day}: ${conflict.message}`
                };
            }
        }

        return { valid: true };
    }

    /**
     * Valida que el estudiante no tenga una inscripción CONFIRMED en el mismo período
     * @param studentId - ID del estudiante
     * @param periodId - ID del período
     * @returns true si no existe inscripción confirmada, false si ya existe
     */
    async validateNoDuplicateConfirmed(
        studentId: number,
        periodId: number
    ): Promise<{ valid: boolean; reason?: string }> {
        const existingEnrollment = await this.enrollmentRepository.findOne({
            where: {
                studentId,
                period: { id: periodId },
                status: EnrollmentStatus.CONFIRMED
            }
        });

        if (existingEnrollment) {
            return {
                valid: false,
                reason: `Ya existe una inscripción confirmada para este período (ID: ${existingEnrollment.id})`
            };
        }

        return { valid: true };
    }

    /**
     * Detecta conflictos de tiempo entre horarios
     * @param times - Array de horarios con beginTime y endTime
     * @returns objeto con información del conflicto o null si no hay conflicto
     */
    private findTimeConflict(times: Array<{
        beginTime: string;
        endTime: string;
        groupId: number;
        groupName: string;
    }>): { message: string } | null {
        for (let i = 0; i < times.length; i++) {
            for (let j = i + 1; j < times.length; j++) {
                const a = times[i];
                const b = times[j];

                // Convertir a minutos para comparar
                const aStart = this.timeToMinutes(a.beginTime);
                const aEnd = this.timeToMinutes(a.endTime);
                const bStart = this.timeToMinutes(b.beginTime);
                const bEnd = this.timeToMinutes(b.endTime);

                // Hay conflicto si se solapan
                if (aStart < bEnd && bStart < aEnd) {
                    return {
                        message: `Grupo ${a.groupName} (${a.beginTime}-${a.endTime}) choca con Grupo ${b.groupName} (${b.beginTime}-${b.endTime})`
                    };
                }
            }
        }
        return null;
    }

    /**
     * Convierte tiempo en formato HH:MM a minutos desde medianoche
     * @param time - Tiempo en formato HH:MM
     * @returns Minutos desde medianoche
     */
    private timeToMinutes(time: string): number {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
    }
}
