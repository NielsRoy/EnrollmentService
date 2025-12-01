import { Controller, Get, ParseIntPipe } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { SubjectGroupService } from './services/subject-group.service';
import { EnrollmentService } from './services/enrollment.service';
import { CreateEnrollmentRequestDto } from './dto/requests/create-enrollment-request.dto';

@Controller()
export class AppController {
  constructor(
    private readonly subjectGroupService: SubjectGroupService,
    private readonly enrollmentService: EnrollmentService,
  ) { }

  @MessagePattern('get_subject_groups_by_plan_subject_ids')
  getSubjectGroupsByPlanSubjectIds(@Payload() planSubjectIds: number[]) {
    return this.subjectGroupService.getSubjectGroupsByPlanSubjectIds(planSubjectIds);
  }

  @MessagePattern('create_enrollment_request')
  createEnrollmentRequest(@Payload() dto: CreateEnrollmentRequestDto) {
    return this.enrollmentService.createEnrollmentRequest(dto);
  }

  @MessagePattern('get_enrollment_status')
  getEnrollmentStatus(@Payload('enrollmentId', ParseIntPipe) enrollmentId: number) {
    return this.enrollmentService.getEnrollmentStatus(enrollmentId);
  }

  @MessagePattern('get_student_enrollments')
  getStudentEnrollments(
    @Payload() payload: { studentId: number; periodId?: number }
  ) {
    return this.enrollmentService.getStudentEnrollments(
      payload.studentId,
      payload.periodId
    );
  }
}
