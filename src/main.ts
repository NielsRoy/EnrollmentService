import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport,  } from '@nestjs/microservices';
import { envs } from './config/env';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.NATS,
      options: {
        servers: [`nats://${envs.NATS_HOST}:${envs.NATS_PORT}`],
      },
    },
  );
  await app.listen();
}
bootstrap();
