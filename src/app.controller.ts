import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { SubjectGroupService } from './services/subject-group.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly subjectGroupService: SubjectGroupService,
  ) { }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @MessagePattern('get_subject_groups_by_plan_subject_ids')
  getSubjectGroupsByPlanSubjectIds(@Payload() planSubjectIds: number[]) {
    return this.subjectGroupService.getSubjectGroupsByPlanSubjectIds(planSubjectIds);
  }
}
