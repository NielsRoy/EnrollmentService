import { EnrollmentStatus } from '../../enum/enrollment-status.enum';

export class SubjectGroupInfoDto {

    subjectGroupId: number;


    subjectName: string;


    subjectCode: string;


    group: string;


    teacher: string;
}

export class EnrollmentResponseDto {

    id: number;

    status: EnrollmentStatus;


    datetime: Date;

    rejectionReason?: string | null;

    processedAt?: Date | null;


    periodId: number;


    studentId: number;


    online: boolean;

    subjectGroups: SubjectGroupInfoDto[];
}
