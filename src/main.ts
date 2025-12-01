import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { envs } from './config/env';

async function bootstrap() {
  // Crear aplicación híbrida (HTTP + Microservicios)
  const app = await NestFactory.create(AppModule);

  // Conectar NATS (para requests síncronos desde Gateway)
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.NATS,
    options: {
      servers: [`nats://${envs.NATS_HOST}:${envs.NATS_PORT}`],
    },
  });

  // Conectar Kafka (para consumir eventos de inscripción)
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: 'enrollment-service-consumer',
        brokers: ['localhost:9093'],
      },
      consumer: {
        groupId: envs.KAFKA_GROUP_ID,
      },
    },
  });

  // Iniciar todos los microservicios
  await app.startAllMicroservices();

  console.log('🚀 EnrollmentService is running');
  console.log('📡 NATS connected on', `${envs.NATS_HOST}:${envs.NATS_PORT}`);
  console.log('📨 Kafka consumer connected on localhost:9093');
}

bootstrap();
