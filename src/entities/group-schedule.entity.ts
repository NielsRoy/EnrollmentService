import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { SubjectGroup } from "./subject-group.entity";
import { Schedule } from "./schedule.entity";
import { Classroom } from "./classroom.entity";
import { Day } from "../enum/Day.enum";

@Entity()
export class GroupSchedule {

  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Schedule, { nullable: false })
  schedule: Schedule;

  @ManyToOne(() => Classroom, { nullable: false })
  classroom: Classroom;

  @Column('enum', { enum: Day, nullable: false })
  day: Day;

  @ManyToOne(() => SubjectGroup, { nullable: false })
  subjectGroup: SubjectGroup;
}