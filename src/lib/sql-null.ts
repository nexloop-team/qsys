// SQL NULL for a required function argument. The generated database types never mark function
// arguments as nullable, but some of our functions give NULL a meaning ("no station", "undo the
// result", "a new booking"). Optional arguments that default to NULL are simply left out instead.
export const sqlNull = <T>(value: T | null | undefined): T => (value ?? null) as T;
