import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, Unique } from "typeorm";
import { Term } from "./term.entity";

@Entity()
@Unique(["term", "number"])
export class Period {

  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  number: number;

  @Column({
    type: 'enum',
    enum: ['ACTIVE', 'INACTIVE'],
    default: 'INACTIVE'
  })
  status: 'ACTIVE' | 'INACTIVE';

  @ManyToOne(() => Term, { nullable: false, onDelete: "CASCADE" })
  term: Term;
}