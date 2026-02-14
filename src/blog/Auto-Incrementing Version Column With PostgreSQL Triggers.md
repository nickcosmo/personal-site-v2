---
title: Auto-Incrementing Version Column With PostgreSQL Triggers
description: Learn how to create a PostgreSQL trigger to automatically increment a version column on updates, ensuring data integrity and simplifying version management.
tags: ["PostgreSQL", "Triggers", "Database"]
ogImage: og-images/auto-incrementing-version-column-with-postgres-triggers.png
author: Nick Cosmo
published: 2025-02-04
---


## Introduction

When building database schemas, there will often be the desire to create a versioning column on all or some database tables. A developer's knee-jerk reaction may be to implement this at the code level. This approach can be quite simple depending on how your code is architected. Say you have a single CRUD service/module in your application, you could just add some logic there to increment a version column during an update. This approach can work fine but it is yet one more thing that needs to be kept track of in case your code-level patterns change from refactoring. 

Utilizing a database trigger is a simple and more efficient approach to solving this problem. This is something that PostgreSQL (Postgres), among most modern databases, supports as a feature and its use can be quite powerful. To illustrate how this can be done we will walk through how to build a trigger in Postgres to implement an auto-incrementing versioning column.

Within this post, I will assume you have minimal knowledge of Postgres triggers and will explain every step of the way.

## What Are Triggers and How Do They Work?

Postgres triggers let you create a declaration to execute a function within the database that ties into certain actions. Some might think of these as "hooks" that hook into database actions. The actions that I am referring to here are the DML statements `INSERT`, `UPDATE`, and `DELETE`. These actions are specified in the SQL standard. The logic contained in the function that is triggered can be further specified to fire either `BEFORE` or `AFTER` the action that is taking place. In addition to the previously mentioned DML commands, Postgres also supports adding triggers around the `TRUNCATE` action which not all databases support.

Another point to keep in mind is that triggers are transactional. This means that triggers are part of the same transaction as the statement that fired them and if the transaction is rolled back, the trigger's actions are also rolled back. This is important to keep in mind for debugging purposes and something to consider from an observability perspective when implementing triggers. Whenever you are adding more logic to your database there could, of course, be more failure points to consider that now lie outside of the code level.

## Building A Postgres Trigger

To first clarify what our goal is here. We will create a table with a column called `version` that will initialize to 0, and our goal will be for each `UPDATE` statement executed against a row in this table, the `version` column will increment by 1.

Let's start with a DML statement to create a table to apply our trigger.

```
CREATE TABLE table_1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL DEFAULT 0,
  name VARCHAR NOT NULL
);
```

In this statement, I have added three columns to the table `table_1`.
- `id` - This is set as our primary key and defaults to use the native Postgres function of `gen_random_uuid()` to give us a unique identifier for each row in the table.
- `version` - This will serve as the version column we will increment with our trigger. It is set to default to 0.
- `name` - A `VARCHAR` column we will use to test applying our updates.

Now to get something to work with, let's insert a row to our new table.

```
INSERT INTO table_1 (name) VALUES ('Nick');
```

If you run a `SELECT` statement you should see a new record in `table_1`.

```
SELECT * FROM table_1;
```

The first step to creating a trigger is to create a function. That may sound a little strange but creating a trigger is a two-part process. First, create a function, then create the trigger which will utilize the function. All the magic will happen inside the function which must be set as a special type of Postgres function. The function is created in a similar fashion to any other function or stored procedure except it must not take any arguments and must return a type of `TRIGGER`. In our case, the function will look like this.

```
CREATE OR REPLACE FUNCTION increment_version() 
RETURNS TRIGGER AS $$
BEGIN
    NEW.version = COALESCE(OLD.version, 0) + 1;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;
```

A couple of points to note on the above statement:
- I use `CREATE OR REPLACE` here which works as an "upsert" action for the function. If this is the first time creating a function just writing `CREATE` would have worked just fine.
- The function is declared to return a trigger with `RETURNS TRIGGER`.
- The `OLD` and `NEW` variables are available inside all Postgres triggers and correspond to the old table record and new table record respectively. The value for the column `version` is accessed through dot notation.
- `LANGUAGE plpgsql` declares that the function is written in the `PL/pgSQL` procedural language.

Having the function, we can now apply the trigger to our table.

```
CREATE OR REPLACE TRIGGER update_version 
BEFORE UPDATE ON table_1 
FOR EACH ROW
EXECUTE FUNCTION increment_version();
```

The statement to apply the trigger is a little more simple than creating the function. 
- The trigger is created with the name `update_version`.
- `BEFORE UPDATE` specifies that we would like to fire the trigger before an update statement executes on `table_1`.
- `FOR EACH ROW` specifies that this should apply to every row affected by the update statement.
- `EXECUTE FUNCTION increment_version()` declares that our function from the previous step will be called here.

The trigger is now applied. If you execute an update statement to the record we created earlier, you should see the version column increment by 1 with each update.

With the function already created it becomes very easy to extend this trigger to new tables. You would simply run the `CREATE OR REPLACE TRIGGER` statement against the table where you would want to apply the trigger. For example, if we had another table, `table_2`, we could execute the statement below.

```
CREATE OR REPLACE TRIGGER update_version 
BEFORE UPDATE ON table_2 
FOR EACH ROW
EXECUTE FUNCTION increment_version();
```

One point to note is that we used the same name for the trigger, `update_version`, on this new table, and that is perfectly ok! Trigger names must be unique within the context of the same table, but they can be the same across different tables. So, if we created a new trigger on `table_2`, we would have to give it a name other than `update_version` since this is now taken.
## Adding Better Validation

At this point, you may be asking yourself, "What if the table didn't have a `version` column?". The answer to this is that the function we wrote would raise an error, and as mentioned before the trigger is transactional so it would make the entire transaction that this action was a part of rollback. If you are very careful and have good test coverage this may not be something to worry about, and the errors would surface rather quickly since you would be seeing a ton of failures coming from update operations. But, alas, programmers are human (for now), and we make mistakes. 

To beef up the validation, we can update our function with an extra bit of logic that would put in a fail-safe for us in case the `version` column did not exist on the table. Here is the revised function.

```
CREATE OR REPLACE FUNCTION increment_version() 
RETURNS TRIGGER AS $$
DECLARE
	table_columns TEXT[];
	column_exists BOOLEAN;
BEGIN
	SELECT ARRAY_AGG(column_name)
	 INTO table_columns 
	 FROM information_schema.columns 
	 WHERE table_name = TG_TABLE_NAME 
	 AND table_schema = TG_TABLE_SCHEMA;

	column_exists := 'version' = ANY(table_columns);
	
	IF column_exists IS TRUE THEN
    	NEW.version = COALESCE(OLD.version, 0) + 1;
    END IF;

    RETURN NEW;
END
$$ LANGUAGE plpgsql;
```

The updated function has some new logic to add the validation.
- A query is made to read the columns of our table by querying against the `information_schema.columns` table, which is maintained under the hood by Postgres. A filter is made against the query with `TG_TABLE_NAME` and `TG_TABLE_SCHEMA`, which are variables that are available inside Postgres triggers and correspond to the name of the table and the schema where the table is located.
- A check is made to see whether the `version` column exists with `column_exists := 'version' = ANY(table_columns);`.
- The operation to increment the `version` column is made conditional depending on whether or not the column exists on the table.

Since we have overwritten the function with `CREATE OR REPLACE FUNCTION`, the name has not changed and this update will automatically go into effect wherever it is applied!

## Conclusion

We were able to create a basic Postgres trigger to add versioning to our database records. This is a very simple use case, and the applications of Postgres triggers are endless. Hopefully this gives some insight into how easy it can be to implement a Postgres trigger and gets you thinking about what code-level logic can transition to your database layer.

To read more about Postgres triggers, you can check out the docs [here](https://www.postgresql.org/docs/current/sql-createtrigger.html).

Thanks for reading!


## Supporting SQL
```
CREATE TABLE table_1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL DEFAULT 0,
  name VARCHAR NOT NULL
);

CREATE TABLE table_2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--   version INTEGER NOT NULL DEFAULT 0,
  name VARCHAR NOT NULL
);

INSERT INTO table_1 (name) VALUES ('Nick');

SELECT * FROM table_1;

DROP TABLE table_1;

CREATE OR REPLACE FUNCTION increment_version() 
RETURNS TRIGGER AS $$
DECLARE
	table_columns TEXT[];
	column_exists BOOLEAN;
BEGIN
	SELECT ARRAY_AGG(column_name)
	 INTO table_columns 
	 FROM information_schema.columns 
	 WHERE table_name = TG_TABLE_NAME 
	 AND table_schema = TG_TABLE_SCHEMA;

	column_exists := 'version' = ANY(table_columns);
	
	IF column_exists IS TRUE THEN
    	NEW.version = COALESCE(OLD.version, 0) + 1;
    END IF;

    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_version() 
RETURNS TRIGGER AS $$
BEGIN
    NEW.version = COALESCE(OLD.version, 0) + 1;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;


CREATE OR REPLACE TRIGGER update_version 
BEFORE UPDATE ON table_1 
FOR EACH ROW
EXECUTE FUNCTION increment_version();

CREATE OR REPLACE TRIGGER update_version 
BEFORE UPDATE ON table_2 
FOR EACH ROW
EXECUTE FUNCTION increment_version();



UPDATE table_1 SET name = 'Nick' WHERE id = '0c9f4d2c-d36e-44d8-83e8-adace2b7bb42';


SELECT * FROM table_2;
INSERT INTO table_2 ("name") VALUES ('Nick');
UPDATE table_2 SET name = 'Nick L' WHERE id = '0d8b48fb-9fae-4633-a41e-600233f213f6';

SELECT ARRAY_AGG(column_name) FROM information_schema.columns WHERE table_name = 'table_2';
```