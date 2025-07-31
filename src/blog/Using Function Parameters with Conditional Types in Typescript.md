---
title: Using Function Parameters with Conditional Types in Typescript
description: A guide on how to use function parameters with conditional types in TypeScript to create flexible and type-safe functions.
tags: ["TypeScript", "Conditional Types", "Programming"]
author: Nick Cosmo
published: 2024-04-04
---


A common scenario when building with Typescript is having a function that should conditionally return one of two different types from a function, while still getting Typescript's static typing benefits. You can always use `as`, but this can lead to errors in case logic from your function ever changes. 

This scenario can be solved by constructing a conditional type in Typescript. The concept itself is quite simple but becomes powerful when combined with querying data – which we will uncover towards the end of this post. But first, a contrived example...

## A Basic Example

Say you have two different interfaces a `Cat` interface and a `Dog` interface.
```
interface Cat {
 sound: 'meow';
}

interface Dog {
 sound: 'woof';
}
```
And you would like to conditionally return one of the two from a function.

With conditional types, a ternary-like syntax can be used to construct a new type `CatOrDog` that can return either a `Cat` or `Dog` based on a generic.
```
type CatOrDog<T extends 'cat' | 'dog'> = T extends 'cat' ? Cat : Dog;
```
This new type can then be used in a function to conditionally return a `Cat` or a `Dog` based on a function parameter to dictate which we should expect to receive from a function.
```
function getCatOrDog<T extends 'cat' | 'dog'>(option: T): CatOrDog<T>  {
 if (option === 'cat') {
  return {sound: 'meow'};
 }

 if (option === 'dog') {
  return {sound: 'woof'};
 }
}

getCatOrDog('cat'); // returns Cat
getCatOrDog('dog'); // returns Dog
```
The above function will conditionally return a `Cat` or a `Dog` type depending on what is passed into the `option` parameter. This leads to a great developer experience as you can take advantage of Typescript's static type checking here and some modern IDEs can give you intelli-sense to flag any type errors when using this function during development.

Now that we have a basic example in place, let's move on to a more useful situation...

## A Practical Use Case

The `CatOrDog` example is a contrived use of this pattern. The benefits become quite apparent when you combine this with fetching data from a database, which is where I find myself reaching for this pattern most often (usually with an ORM like TypeORM).

Say you have an application where you store user information in a table called `user` and contact information in a separate table called `contact_info` and there is a 1:1 relationship between the two tables, you may have interfaces set up similar to the following, which represent an entity structure in your database.

```
interface User {
 id: string;
 name: string;
}

interface ContactInfo {
 phone: string;
 address: string;
 userId: string;
}
```

Then say when you query users you may want to conditionally hydrate the contact information for a user. You could make a conditional type that uses a function parameter, as we did before, to determine whether you should expect to receive an instance of `User` or `User & ContactInfo`. The function can use the same function parameter to add a join to a query based on the input value.

```
type UserOrUserWithContactInfo<T extends boolean> = T extends true ? User & ContactInfo : User;

async function fetchUser<T extends boolean>(id: string, withContactInfo: T): Promise<UserOrUserWithContactInfo<T>> {
 const query = `
  SELECT *
  FROM user
 `

 if (withContactInfo) {
  query += `
   LEFT JOIN contact_info on user.id = contact_info."userId"
  `
 }

 const query += `
  WHERE user.id = '${id}'
 `

 // assume this executes our query string
 return connection.query(query);
}

await fetchUsers(false); // returns User
await fetchUsers(true); // returns User & ContactInfo
```
Now when using this function you can benefit from static type checking by conditionally adding a join to a query to fetch the contact information related to a user. This utilizes the new `UserOrUserWithContactInfo` conditional type which returns either a `User` or `User & ContactInfo` based on the `boolean` value that we pass to the `withContactInfo` function parameter.

You can read more about Typescript conditional types [here](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html).
