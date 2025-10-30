import { Column, CreateDateColumn, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Period } from "./period.entity";
import { EnrollmentDetail } from "./enrollment-detail.entity";

@Entity()
export class Enrollment {

  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn()
  datetime: Date;

  @Column()
  online: boolean;

  @ManyToOne(() => Period, { nullable: false, onDelete: "CASCADE" })
  period: Period;

  @Column()
  studentId: number;

  @OneToMany(() => EnrollmentDetail, (enrollmentDetail) => enrollmentDetail.enrollment)
  registrationDetails: EnrollmentDetail[];
}
