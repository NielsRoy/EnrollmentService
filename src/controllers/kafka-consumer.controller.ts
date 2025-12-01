import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { EnrollmentRequestEvent } from '../dto/events/enrollment-request.event';
import { WorkerPoolService } from '../services/worker-pool.service';

@Controller()
export class KafkaConsumerController implements OnModuleInit {
    private readonly logger = new Logger(KafkaConsumerController.name);

    constructor(
        private readonly workerPoolService: WorkerPoolService,
    ) { }

    onModuleInit() {
        this.logger.log('Kafka Consumer Controller initialized and ready to consume messages');

        // Log pool stats periodically
        setInterval(() => {
            const stats = this.workerPoolService.getPoolStats();
            this.logger.debug(
                `Worker Pool Stats - ` +
                `Busy: ${stats.busyWorkers}/${stats.poolSize}, ` +
                `Available: ${stats.availableWorkers}, ` +
                `Queued: ${stats.queuedTasks}`
            );
        }, 10000); // Log every 10 seconds
    }

    /**
     * Consume eventos de solicitudes de inscripción desde Kafka
     * y los delega al pool de worker threads para procesamiento paralelo
     * @param event - Evento de solicitud de inscripción
     */
    @EventPattern('enrollment-requests')
    async handleEnrollmentRequest(@Payload() event: EnrollmentRequestEvent) {
        this.logger.log(`Received enrollment request: ${event.enrollmentId}`);

        try {
            // Delegar al pool de workers (hilos reales)
            await this.workerPoolService.processEnrollmentRequest(event);
            this.logger.log(`Enrollment request ${event.enrollmentId} queued for processing`);
        } catch (error) {
            this.logger.error(`Error queueing enrollment request ${event.enrollmentId}:`, error);
        }
    }
}
