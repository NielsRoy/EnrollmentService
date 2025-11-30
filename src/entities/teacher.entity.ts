import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity()
export class Teacher {

  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    unique: true,
  })
  code: number;

  @Column({
    unique: true,
  })
  ci: number;

  @Column()
  name: string;

  @Column({
    unique: true,
    nullable: true,
  })
  email: string;

  @Column({
    nullable: true,
  })
  cellphone: number;
}