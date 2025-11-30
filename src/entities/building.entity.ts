import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity()
export class Building {

  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    unique: true,
  })
  number: number;

  @Column()
  description: string;
}