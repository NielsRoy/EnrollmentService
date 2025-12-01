import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, Unique, VersionColumn } from "typeorm";
import { Teacher } from "./teacher.entity";

@Entity()
@Unique(["planSubjectId", "group"])
export class SubjectGroup {

  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    default: 0,
  })
  spots: number;

  @Column()
  group: string;

  @ManyToOne(
    () => Teacher,
    { nullable: false, onDelete: "CASCADE" }
  )
  teacher: Teacher;

  @Column()
  planSubjectId: number;

  @VersionColumn()
  version: number;
}