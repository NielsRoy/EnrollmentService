import { Column, CreateDateColumn, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Period } from "./period.entity";
import { EnrollmentDetail } from "./enrollment-detail.entity";
import { EnrollmentStatus } from "../enum/enrollment-status.enum";

@Entity()
export class Enrollment {

  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn()
  datetime: Date;

  @Column()
  online: boolean;

  @Column({
    type: 'varchar',
    length: 20,
    default: EnrollmentStatus.PENDING
  })
  status: EnrollmentStatus;

  @Column({
    type: 'text',
    nullable: true
  })
  rejectionReason: string | null;

  @Column({
    type: 'timestamp',
    nullable: true
  })
  processedAt: Date | null;

  @ManyToOne(() => Period, { nullable: false, onDelete: "CASCADE" })
  period: Period;

  @Column()
  studentId: number;

  @OneToMany(() => EnrollmentDetail, (enrollmentDetail) => enrollmentDetail.enrollment)
  enrollmentDetails: EnrollmentDetail[];
}
