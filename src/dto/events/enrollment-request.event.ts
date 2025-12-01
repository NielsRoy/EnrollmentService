export class EnrollmentRequestEvent {
    enrollmentId: number;
    studentId: number;
    periodId: number;
    subjectGroupIds: number[];
    online: boolean;
    timestamp: Date;
}
