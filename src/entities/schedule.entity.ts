import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity()
export class Schedule {

  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "time" })
  beginTime: string;

  @Column({ type: "time" })
  endTime: string;
}
