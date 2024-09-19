# Directus TimescaleDB


## Issues:

TimescaleDB [does not support primary keys](https://docs.timescale.com/use-timescale/latest/hypertables/hypertables-and-unique-indexes/).

So we try to see if we can just drop the unique constraint of the primary key before creating the table.

After converting to hypertable, we get [this error](https://github.com/directus/directus/blob/46611e67512279127216ddeec99a810cfb450dce/api/src/utils/get-schema.ts#L137).

