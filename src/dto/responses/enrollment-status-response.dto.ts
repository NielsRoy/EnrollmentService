import { EnrollmentStatus } from '../../enum/enrollment-status.enum';

export class EnrollmentStatusResponseDto {
    id: number;

    status: EnrollmentStatus;

    datetime: Date;

    rejectionReason?: string | null;

    processedAt?: Date | null;
}
