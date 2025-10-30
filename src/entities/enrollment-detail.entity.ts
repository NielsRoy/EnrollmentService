import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, Unique } from "typeorm";
import { Enrollment } from "./enrollment.entity";

@Entity()
@Unique(["enrollment","subjectGroupId"])
export class EnrollmentDetail {

  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Enrollment, { nullable: false, onDelete: "CASCADE" })
  enrollment: Enrollment;

  @Column()
  subjectGroupId: number;
}