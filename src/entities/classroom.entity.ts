import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, Unique } from "typeorm";
import { Building } from "./building.entity";

@Entity()
@Unique(["building", "number"])
export class Classroom {

  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  number: number;

  @Column({
    default: 0,
  })
  floor: number;

  @ManyToOne(
    () => Building, { nullable: false, onDelete: "CASCADE" }
  )
  building: Building;

  @Column({
    default: 40
  })
  capacity: number;
}