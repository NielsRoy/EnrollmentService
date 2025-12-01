import { parentPort, workerData } from 'worker_threads';
import { DataSource } from 'typeorm';
import { Enrollment } from '../entities/enrollment.entity';
import { EnrollmentDetail } from '../entities/enrollment-detail.entity';
import { SubjectGroup } from '../entities/subject-group.entity';
import { GroupSchedule } from '../entities/group-schedule.entity';
import { Schedule } from '../entities/schedule.entity';
import { Period } from '../entities/period.entity';
import { Term } from '../entities/term.entity';
import { Teacher } from '../entities/teacher.entity';
import { Classroom } from '../entities/classroom.entity';
import { Building } from '../entities/building.entity';
import { EnrollmentStatus } from '../enum/enrollment-status.enum';
import { EnrollmentRequestEvent } from '../dto/events/enrollment-request.event';

/**
 * Worker Thread que procesa solicitudes de inscripción
 * Este archivo se ejecuta en un hilo separado del proceso principal
 */

// Configuración de la base de datos (recibida desde el hilo principal)
const dbConfig = workerData.dbConfig;

// Crear conexión a la base de datos para este worker
const dataSource = new DataSource({
    type: 'postgres',
    host: dbConfig.host,
    port: dbConfig.port,
    username: dbConfig.username,
    password: dbConfig.password,
    database: dbConfig.database,
    entities: [
        Enrollment,
        EnrollmentDetail,
        SubjectGroup,
        GroupSchedule,
        Schedule,
        Period,
        Term,
        Teacher,
        Classroom,
        Building,
    ],
    synchronize: false,
    ssl: dbConfig.ssl,
    extra: dbConfig.extra,
});

let isInitialized = false;

/**
 * Inicializa la conexión a la base de datos
 */
async function initialize() {
    if (!isInitialized) {
        await dataSource.initialize();
        isInitialized = true;
        console.log(`[Worker ${workerData.workerId}] Database connection initialized`);
    }
}

/**
 * Procesa una solicitud de inscripción
 */
async function processEnrollmentRequest(event: EnrollmentRequestEvent): Promise<void> {
    const { enrollmentId, studentId, periodId, subjectGroupIds } = event;

    console.log(`[Worker ${workerData.workerId}] Processing enrollment ${enrollmentId}`);

    try {
        // Obtener enrollment
        const enrollmentRepo = dataSource.getRepository(Enrollment);
        const enrollment = await enrollmentRepo.findOne({
            where: { id: enrollmentId }
        });

        if (!enrollment) {
            console.error(`[Worker ${workerData.workerId}] Enrollment ${enrollmentId} not found`);
            return;
        }

        if (enrollment.status !== EnrollmentStatus.PENDING) {
            console.warn(`[Worker ${workerData.workerId}] Enrollment ${enrollmentId} is not PENDING`);
            return;
        }

        // Validar cupos
        const spotsValidation = await validateSpots(subjectGroupIds);
        if (!spotsValidation.valid) {
            await rejectEnrollment(enrollmentId, spotsValidation.reason!);
            return;
        }

        // Validar conflictos de horario
        const scheduleValidation = await validateScheduleConflicts(subjectGroupIds);
        if (!scheduleValidation.valid) {
            await rejectEnrollment(enrollmentId, scheduleValidation.reason!);
            return;
        }

        // Validar duplicados
        const duplicateValidation = await validateNoDuplicateConfirmed(studentId, periodId);
        if (!duplicateValidation.valid) {
            await rejectEnrollment(enrollmentId, duplicateValidation.reason!);
            return;
        }

        // Confirmar inscripción
        await confirmEnrollment(enrollmentId, subjectGroupIds);

    } catch (error) {
        console.error(`[Worker ${workerData.workerId}] Error processing enrollment ${enrollmentId}:`, error);
        await rejectEnrollment(enrollmentId, `Error interno: ${error.message}`);
    }
}

/**
 * Valida que todos los grupos tengan cupos disponibles
 */
async function validateSpots(subjectGroupIds: number[]): Promise<{ valid: boolean; reason?: string }> {
    const subjectGroupRepo = dataSource.getRepository(SubjectGroup);
    const groups = await subjectGroupRepo.findByIds(subjectGroupIds);

    if (groups.length !== subjectGroupIds.length) {
        return { valid: false, reason: 'Algunos grupos no existen' };
    }

    const groupsWithoutSpots = groups.filter(g => g.spots <= 0);
    if (groupsWithoutSpots.length > 0) {
        const groupNames = groupsWithoutSpots.map(g => `Grupo ${g.group} (ID: ${g.id})`).join(', ');
        return { valid: false, reason: `Sin cupos disponibles en: ${groupNames}` };
    }

    return { valid: true };
}

/**
 * Valida conflictos de horario
 */
async function validateScheduleConflicts(subjectGroupIds: number[]): Promise<{ valid: boolean; reason?: string }> {
    const groupScheduleRepo = dataSource.getRepository(GroupSchedule);

    const schedules = await groupScheduleRepo
        .createQueryBuilder('gs')
        .innerJoin('gs.schedule', 'schedule')
        .innerJoin('gs.subjectGroup', 'sg')
        .innerJoin('plan_subject', 'ps', 'ps.id = sg."planSubjectId"')
        .innerJoin('subject', 's', 's.id = ps."subjectId"')
        .where('gs.subjectGroup.id IN (:...ids)', { ids: subjectGroupIds })
        .select([
            'gs.day AS day',
            'schedule.beginTime AS "beginTime"',
            'schedule.endTime AS "endTime"',
            'sg.id AS "groupId"',
            'sg.group AS "groupName"',
            's.code AS "subjectCode"'
        ])
        .getRawMany();

    // Agrupar por día
    const byDay = new Map<string, Array<{
        beginTime: string;
        endTime: string;
        groupId: number;
        groupName: string;
        subjectCode: string;
    }>>();

    for (const gs of schedules) {
        if (!byDay.has(gs.day)) {
            byDay.set(gs.day, []);
        }
        byDay.get(gs.day)!.push({
            beginTime: gs.beginTime,
            endTime: gs.endTime,
            groupId: gs.groupId,
            groupName: gs.groupName,
            subjectCode: gs.subjectCode
        });
    }

    // Verificar conflictos
    for (const [day, times] of byDay.entries()) {
        const conflict = findTimeConflict(times);
        if (conflict) {
            return { valid: false, reason: `Conflicto de horario el ${day}: ${conflict.message}` };
        }
    }

    return { valid: true };
}

/**
 * Valida que no exista inscripción confirmada
 */
async function validateNoDuplicateConfirmed(
    studentId: number,
    periodId: number
): Promise<{ valid: boolean; reason?: string }> {
    const enrollmentRepo = dataSource.getRepository(Enrollment);

    const existing = await enrollmentRepo.findOne({
        where: {
            studentId,
            period: { id: periodId },
            status: EnrollmentStatus.CONFIRMED
        }
    });

    if (existing) {
        return { valid: false, reason: `Ya existe inscripción confirmada (ID: ${existing.id})` };
    }

    return { valid: true };
}

/**
 * Detecta conflictos de tiempo
 */
function findTimeConflict(times: Array<{
    beginTime: string;
    endTime: string;
    groupId: number;
    groupName: string;
    subjectCode: string;
}>): { message: string } | null {
    for (let i = 0; i < times.length; i++) {
        for (let j = i + 1; j < times.length; j++) {
            const a = times[i];
            const b = times[j];

            const aStart = timeToMinutes(a.beginTime);
            const aEnd = timeToMinutes(a.endTime);
            const bStart = timeToMinutes(b.beginTime);
            const bEnd = timeToMinutes(b.endTime);

            if (aStart < bEnd && bStart < aEnd) {
                return {
                    message: `${a.subjectCode} - Grupo ${a.groupName} (${a.beginTime}-${a.endTime}) choca con ${b.subjectCode} - Grupo ${b.groupName} (${b.beginTime}-${b.endTime})`
                };
            }
        }
    }
    return null;
}

/**
 * Convierte tiempo a minutos
 */
function timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
}

/**
 * Confirma inscripción y reduce cupos
 */
async function confirmEnrollment(enrollmentId: number, subjectGroupIds: number[]): Promise<void> {
    await dataSource.transaction(async (manager) => {
        // Reducir cupos con lock
        for (const subjectGroupId of subjectGroupIds) {
            const subjectGroup = await manager.findOne(SubjectGroup, {
                where: { id: subjectGroupId },
                lock: { mode: 'pessimistic_write' }
            });

            if (!subjectGroup || subjectGroup.spots <= 0) {
                throw new Error(`No hay cupos disponibles para grupo ${subjectGroupId}`);
            }

            subjectGroup.spots -= 1;
            await manager.save(subjectGroup);
        }

        // Actualizar enrollment
        await manager.update(Enrollment, enrollmentId, {
            status: EnrollmentStatus.CONFIRMED,
            processedAt: new Date(),
            rejectionReason: null,
        });

        console.log(`[Worker ${workerData.workerId}] Enrollment ${enrollmentId} CONFIRMED`);
    });
}

/**
 * Rechaza inscripción
 */
async function rejectEnrollment(enrollmentId: number, reason: string): Promise<void> {
    const enrollmentRepo = dataSource.getRepository(Enrollment);

    await enrollmentRepo.update(enrollmentId, {
        status: EnrollmentStatus.REJECTED,
        rejectionReason: reason,
        processedAt: new Date(),
    });

    console.log(`[Worker ${workerData.workerId}] Enrollment ${enrollmentId} REJECTED: ${reason}`);
}

// Escuchar mensajes del hilo principal
parentPort?.on('message', async (message) => {
    if (message.type === 'INIT') {
        await initialize();
        parentPort?.postMessage({ type: 'READY', workerId: workerData.workerId });
    } else if (message.type === 'PROCESS') {
        try {
            await processEnrollmentRequest(message.event);
            parentPort?.postMessage({
                type: 'COMPLETED',
                workerId: workerData.workerId,
                enrollmentId: message.event.enrollmentId
            });
        } catch (error) {
            parentPort?.postMessage({
                type: 'ERROR',
                workerId: workerData.workerId,
                enrollmentId: message.event.enrollmentId,
                error: error.message
            });
        }
    }
});

// Notificar que el worker está listo
console.log(`[Worker ${workerData.workerId}] Thread started`);
