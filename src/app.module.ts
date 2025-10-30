import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { envs } from './config/env';
import { Term } from './entities/term.entity';
import { Period } from './entities/period.entity';
import { Enrollment } from './entities/enrollment.entity';
import { EnrollmentDetail } from './entities/enrollment-detail.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ssl: envs.state === 'production',
      extra: {
        ssl: envs.state === 'production'
        ? { rejectUnauthorized: false }
        : false
      },
      type: 'postgres',
      host: envs.dbHost,
      port: envs.dbPort,
      username: envs.dbUsername,
      password: envs.dbPassword,
      database: envs.dbName,
      autoLoadEntities: true,
    }),
    TypeOrmModule.forFeature([
      Term,
      Period,
      Enrollment,
      EnrollmentDetail,
    ])
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
