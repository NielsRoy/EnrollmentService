import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity()
export class Term {

  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    unique: true,
  })
  year: number;
}