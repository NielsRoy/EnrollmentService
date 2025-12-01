import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker } from 'worker_threads';
import * as path from 'path';
import { envs } from '../config/env';
import { EnrollmentRequestEvent } from '../dto/events/enrollment-request.event';

interface WorkerInfo {
    worker: Worker;
    id: number;
    busy: boolean;
}

interface QueuedTask {
    event: EnrollmentRequestEvent;
    resolve: () => void;
    reject: (error: Error) => void;
}

/**
 * Pool de Worker Threads para procesamiento paralelo de inscripciones
 * Gestiona N hilos reales que procesan solicitudes en paralelo
 */
@Injectable()
export class WorkerPoolService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(WorkerPoolService.name);
    private workers: WorkerInfo[] = [];
    private taskQueue: QueuedTask[] = [];
    private readonly poolSize: number;
    private isInitialized = false;
    private initPromise: Promise<void> | null = null;

    constructor() {
        // Tamaño del pool configurable (default: 5 workers)
        this.poolSize = parseInt(process.env.WORKER_POOL_SIZE || '5', 10);
    }

    async onModuleInit() {
        this.initPromise = this.initializePool();
        await this.initPromise;
    }

    async onModuleDestroy() {
        await this.terminatePool();
    }

    /**
     * Inicializa el pool de workers
     */
    private async initializePool(): Promise<void> {
        this.logger.log(`Initializing worker pool with ${this.poolSize} threads...`);

        const workerPath = path.join(__dirname, '../workers/enrollment.worker.js');

        // Configuración de DB para los workers
        const dbConfig = {
            host: envs.DB_HOST,
            port: envs.DB_PORT,
            username: envs.DB_USERNAME,
            password: envs.DB_PASSWORD,
            database: envs.DB_NAME,
            ssl: envs.STATE === 'production',
            extra: {
                ssl: envs.STATE === 'production' ? { rejectUnauthorized: false } : false
            }
        };

        // Crear workers
        const initPromises: Promise<void>[] = [];

        for (let i = 0; i < this.poolSize; i++) {
            const worker = new Worker(workerPath, {
                workerData: {
                    workerId: i + 1,
                    dbConfig
                }
            });

            const workerInfo: WorkerInfo = {
                worker,
                id: i + 1,
                busy: false
            };

            this.workers.push(workerInfo);

            // Configurar event listeners
            this.setupWorkerListeners(workerInfo);

            // Esperar a que el worker esté listo
            const initPromise = new Promise<void>((resolve) => {
                const readyHandler = (message: any) => {
                    if (message.type === 'READY') {
                        this.logger.log(`Worker ${message.workerId} is ready`);
                        worker.off('message', readyHandler);
                        resolve();
                    }
                };
                worker.on('message', readyHandler);
            });

            initPromises.push(initPromise);

            // Enviar mensaje de inicialización
            worker.postMessage({ type: 'INIT' });
        }

        // Esperar a que todos los workers estén listos
        await Promise.all(initPromises);

        this.isInitialized = true;
        this.logger.log(`Worker pool initialized with ${this.poolSize} threads`);
    }

    /**
     * Configura los listeners de eventos del worker
     */
    private setupWorkerListeners(workerInfo: WorkerInfo): void {
        const { worker, id } = workerInfo;

        worker.on('message', (message) => {
            if (message.type === 'COMPLETED') {
                this.logger.log(`Worker ${message.workerId} completed enrollment ${message.enrollmentId}`);
                this.onWorkerTaskCompleted(workerInfo);
            } else if (message.type === 'ERROR') {
                this.logger.error(`Worker ${message.workerId} error on enrollment ${message.enrollmentId}: ${message.error}`);
                this.onWorkerTaskCompleted(workerInfo);
            }
        });

        worker.on('error', (error) => {
            this.logger.error(`Worker ${id} error:`, error);
            // Reiniciar worker si falla
            this.restartWorker(workerInfo);
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                this.logger.error(`Worker ${id} exited with code ${code}`);
                // Reiniciar worker si termina inesperadamente
                this.restartWorker(workerInfo);
            }
        });
    }

    /**
     * Reinicia un worker que falló
     */
    private async restartWorker(workerInfo: WorkerInfo): Promise<void> {
        this.logger.warn(`Restarting worker ${workerInfo.id}...`);

        const workerPath = path.join(__dirname, '../workers/enrollment.worker.js');

        const dbConfig = {
            host: envs.DB_HOST,
            port: envs.DB_PORT,
            username: envs.DB_USERNAME,
            password: envs.DB_PASSWORD,
            database: envs.DB_NAME,
            ssl: envs.STATE === 'production',
            extra: {
                ssl: envs.STATE === 'production' ? { rejectUnauthorized: false } : false
            }
        };

        const newWorker = new Worker(workerPath, {
            workerData: {
                workerId: workerInfo.id,
                dbConfig
            }
        });

        workerInfo.worker = newWorker;
        workerInfo.busy = false;

        this.setupWorkerListeners(workerInfo);

        // Esperar a que esté listo
        await new Promise<void>((resolve) => {
            const readyHandler = (message: any) => {
                if (message.type === 'READY') {
                    newWorker.off('message', readyHandler);
                    resolve();
                }
            };
            newWorker.on('message', readyHandler);
            newWorker.postMessage({ type: 'INIT' });
        });

        this.logger.log(`Worker ${workerInfo.id} restarted successfully`);
    }

    /**
     * Procesa un evento de inscripción usando un worker del pool
     */
    async processEnrollmentRequest(event: EnrollmentRequestEvent): Promise<void> {
        if (!this.isInitialized) {
            this.logger.log(`Waiting for worker pool to initialize before processing enrollment ${event.enrollmentId}...`);
            if (this.initPromise) {
                await this.initPromise;
            } else {
                // Should not happen if onModuleInit is called, but safety check
                this.initPromise = this.initializePool();
                await this.initPromise;
            }
        }

        return new Promise((resolve, reject) => {
            const task: QueuedTask = { event, resolve, reject };
            this.taskQueue.push(task);
            this.processQueue();
        });
    }

    /**
     * Procesa la cola de tareas asignando a workers disponibles
     */
    private processQueue(): void {
        while (this.taskQueue.length > 0) {
            // Buscar worker disponible
            const availableWorker = this.workers.find(w => !w.busy);

            if (!availableWorker) {
                // No hay workers disponibles, esperar
                this.logger.debug(`All workers busy, ${this.taskQueue.length} tasks in queue`);
                break;
            }

            // Obtener siguiente tarea
            const task = this.taskQueue.shift();
            if (!task) break;

            // Asignar tarea al worker
            this.assignTaskToWorker(availableWorker, task);
        }
    }

    /**
     * Asigna una tarea a un worker específico
     */
    private assignTaskToWorker(workerInfo: WorkerInfo, task: QueuedTask): void {
        workerInfo.busy = true;

        this.logger.log(
            `Assigning enrollment ${task.event.enrollmentId} to Worker ${workerInfo.id} ` +
            `(Queue: ${this.taskQueue.length}, Busy: ${this.workers.filter(w => w.busy).length}/${this.poolSize})`
        );

        // Enviar tarea al worker
        workerInfo.worker.postMessage({
            type: 'PROCESS',
            event: task.event
        });

        // Guardar el resolve/reject para cuando termine
        (workerInfo as any).currentTask = task;
    }

    /**
     * Callback cuando un worker completa una tarea
     */
    private onWorkerTaskCompleted(workerInfo: WorkerInfo): void {
        const task = (workerInfo as any).currentTask as QueuedTask;

        if (task) {
            task.resolve();
            delete (workerInfo as any).currentTask;
        }

        workerInfo.busy = false;

        // Procesar siguiente tarea en la cola
        this.processQueue();
    }

    /**
     * Termina todos los workers del pool
     */
    private async terminatePool(): Promise<void> {
        this.logger.log('Terminating worker pool...');

        const terminatePromises = this.workers.map(workerInfo =>
            workerInfo.worker.terminate()
        );

        await Promise.all(terminatePromises);
        this.workers = [];
        this.isInitialized = false;

        this.logger.log('Worker pool terminated');
    }

    /**
     * Obtiene estadísticas del pool
     */
    getPoolStats() {
        return {
            poolSize: this.poolSize,
            busyWorkers: this.workers.filter(w => w.busy).length,
            availableWorkers: this.workers.filter(w => !w.busy).length,
            queuedTasks: this.taskQueue.length,
            isInitialized: this.isInitialized
        };
    }
}
