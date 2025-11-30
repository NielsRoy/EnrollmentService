import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { envs } from './config/env';
import { Term } from './entities/term.entity';
import { Period } from './entities/period.entity';
import { Enrollment } from './entities/enrollment.entity';
import { EnrollmentDetail } from './entities/enrollment-detail.entity';
import { Building } from './entities/building.entity';
import { Classroom } from './entities/classroom.entity';
import { GroupSchedule } from './entities/group-schedule.entity';
import { Schedule } from './entities/schedule.entity';
import { SubjectGroup } from './entities/subject-group.entity';
import { Teacher } from './entities/teacher.entity';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NATS_SERVICE } from './config/services';
import { SubjectGroupService } from './services/subject-group.service';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ssl: envs.STATE === 'production',
      extra: {
        ssl: envs.STATE === 'production'
          ? { rejectUnauthorized: false }
          : false
      },
      type: 'postgres',
      host: envs.DB_HOST,
      port: envs.DB_PORT,
      username: envs.DB_USERNAME,
      password: envs.DB_PASSWORD,
      database: envs.DB_NAME,
      autoLoadEntities: true,
    }),
    TypeOrmModule.forFeature([
      Term,
      Period,
      Enrollment,
      EnrollmentDetail,
      Building,
      Classroom,
      GroupSchedule,
      Schedule,
      SubjectGroup,
      Teacher,
    ]),
    ClientsModule.register([
      {
        name: NATS_SERVICE,
        transport: Transport.NATS,
        options: {
          servers: [`nats://${envs.NATS_HOST}:${envs.NATS_PORT}`],
        }
      },
      // { 
      //   name: KAFKA_SERVICE,
      //   transport: Transport.KAFKA,
      //   options: {
      //     client: {
      //       brokers: [`${envs.kafkaHost}:${envs.kafkaPort}`],
      //     },
      //   },
      // },
    ]),
  ],
  controllers: [AppController],
  providers: [AppService, SubjectGroupService],
})
export class AppModule { }
