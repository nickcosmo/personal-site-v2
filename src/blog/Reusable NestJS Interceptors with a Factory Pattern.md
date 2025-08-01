---
title: Reusable NestJS Interceptors with a Factory Pattern
description: Learn how to create reusable NestJS interceptors using a factory pattern to reduce code duplication and improve maintainability.
tags: ["NestJS", "Interceptors", "Factory Pattern"]
ogImage: og-images/reusable-nestjs-interceptors-factory-pattern.png
author: Nick Cosmo
published: 2025-01-23
---

## Introduction

Anyone diving into developing APIs with NestJS has seen the benefits of binding logic to API endpoints with interceptors. While interceptors are a great tool to add code execution before your endpoints, they come with some code overhead to create an interceptor for every case in your application. I recently found myself creating interceptors for very similar use cases within a NestJS API and discovered a nice, reusable method of creating interceptors utilizing a factory pattern which alleviates some of the code bloat.

The factory pattern focuses on code reusability and efficiency. It uses an abstract class as a common interface in a factory function to create a NestJS interceptor on the fly rather than creating an individual interceptor.

Within this post I will assume that you have some basic understanding of NestJS. If you are brand new to NestJS I would recommend to have a [look at the docs](https://docs.nestjs.com/), specifically the "Overview" section of the docs before reading this article.

This pattern will also be utilizing TypeScript and I will assume you are familiar with some of the basic patterns of TypeScript (generics, class syntax, typing).

## App Setup

To set the scene, we will begin with a very standard NestJS application. Say we have a REST API with a POST endpoint at `/user/create` where we create new user records.

To follow the standard NestJS patterns, we would have a controller, service, and module.

- Controller

```
@Controller('user')
export class UserController {
	constructor(private readonly userService: UserService) {}

	@Post('create')
	createOneUser(@Body() dto: CreateOneUserDto) {
		return this.userService.createOne(dto);
	}
}
```

- Service

```
@Injectable()
export class UserService {
	createOne(dto: CreateOneUserDto): string {
		// User create stuff goes here...
		return `User created successfully`;
	}
}
```

- Module

```
@Module({
	imports: [],
	controllers: [UserController],
	providers: [
		UserService
	],
	exports: [],
})
export class UserModule {}
```

This is a very standard setup of a NestJS Module so I won't go into any detail on the above code.

Now, say we want to add a validation step to the `createOneUser` controller method before we call our service. This is a case where one would typically reach for an interceptor to add this validation step. The standard pattern would be to implement a standalone interceptor that could hold some validation logic to execute before creating a new user, but what if we wanted to do the same thing in another module for a separate entity model? This would typically require us to create another interceptor to essentially do the same thing. This is the problem we will aim to solve with the factory pattern.

NestJS provides many other ways of binding logic to your endpoints, such as pipes and guards, but for this example, we will create an interceptor with our factory. Hopefully, you will see that this pattern could easily be re-crafted for pipes and guards as well.

## Building An Interceptor Factory

To design this pattern for code reuse, we will introduce an additional service, a validation service, that will be called from the interceptor. So the interceptor will operate more like a pass-through to the new validation service. The flow would then look something like this:

`Interceptor -> Validation Service -> Controller -> Service`

Now, to start creating our factory we will begin by creating an abstract class to use as a common interface for our validation service.

```
export abstract class BaseValidationService<T extends any = any> {
	abstract validateCreate(dto: T): T;
}
```

This establishes an abstract class called `BaseValidationService` which we can extend to ensure we have a common interface for our validation service, and for future validation services that may use this pattern. This gives us type safety as we integrate our validation service into the factory. An abstract method of `validateCreate` has been defined which we can use to hold the validation logic for our endpoint.

For the validation service, we will create a new injectable service that will extend the base service we just defined. We could create a validation service like this:

```
@Injectable()
export class UserValidationService extends BaseValidationService<CreateOneUserDto> {
	constructor() {
		super();
	}

	validateCreate(body: CreateOneUserDto): CreateOneUserDto {
		if (body.id.length < 5) {
			throw new HttpException(
				'id must be greater than 5 digits',
				HttpStatus.BAD_REQUEST,
			);
		}
	
		return body;
	}
}
```

This complies with the format of the `BaseValidationService` through class inheritance and your IDE should give you some notice if something is wrong with how you are extending the abstract class. We define the `validateCreate` function which, for example purposes, will validate that a value for the `id` key in the body is greater than 5 digits. This is something that could typically be accomplished with a package like `class-validator` but this is just to illustrate the pattern.

Now, finally, to create the factory we can write a new factory function that will create an interceptor that will route the request to the validation service method we just defined.

```
export const ValidationCreateFactory = (
	validation: new (...args: any[]) => BaseValidationService,
) => {

	@Injectable()
	class ValidationInterceptor implements NestInterceptor {
		constructor(
			@Inject(validation.name)
			readonly validationService: BaseValidationService,
		) {}
	
		async intercept(
			context: ExecutionContext, 
			next: CallHandler
		): Promise<Observable<any>> {
			let body = context.switchToHttp().getRequest().body;
			body = await this.validationService.validateCreate(body);
			return next.handle().pipe();
		}
	}

	return ValidationInterceptor;
};
```

To take a step back and look at what this is doing. This is a function that accepts a class in the shape of our abstract class of `BaseValidationService` and returns a NestJS interceptor. Inside the interceptor, we go through a fairly standard flow of grabbing the HTTP request body and passing it as an argument to the `validateCreate` method in the validation service. 

One special thing to note is how the interceptor can grab the instance of the validation service from the Nest DI graph. This is accomplished with the `@Inject` decorator, where a token for the validation service is used to create the dependency in its constructor method. This will be important as we add the validation service to our module where we will need to use the long-hand syntax for creating dependencies.

```
@Module({
	imports: [],
	controllers: [UserController],
	providers: [
		UserService,
		{
			useClass: UserValidationService,
			provide: UserValidationService.name,
		},
	],
	exports: [],
})
export class UserModule {}
```

We can now utilize the factory function to put everything together inside the controller with the `@UseInterceptors` decorator much like we would add any typical interceptor.

```
@Controller('user')
export class UserController {
	constructor(private readonly userService: UserService) {}

	@Post('create')
	@UseInterceptors(ValidationCreateFactory(UserValidationService))
	createOneUser(@Body() dto: CreateOneUserDto) {
		return this.userService.createOne(dto);
	}
}
```

Now we have implemented a reusable pattern that would be able to add a validation step to any create endpoint in this Nest application. In case other entity models were added to this API, the separate module could easily tap into this pattern to add a validation step by simply creating a new validation service and using the `ValidationCreateFactory` function that we have defined. Looking further, imagine if there was an update endpoint where we wanted to validate the body of a separate update endpoint. We could create another factory to route the request to a separate validation method, that could be called `validateUpdate`. This is where you would really start to notice the code reusability benefits of this pattern.

## Considerations

There is one special thing to note about this pattern. You will notice that the factory is just a function, which means that each time it is used will equate to a separate function call. Within a large application, this could result in some cold start performance issues as each factory call will be executed each time the app starts up. In most small applications this would probably be negligible but something to note in case you adopt a pattern like this in your application.

## Conclusion

I hope you liked this post and took something away from it. Patterns like this can be really nice when using a framework like NestJS where there is a lot of class-based tooling. Keep in mind the performance drawback to this pattern but if it makes sense to use it in your application I hope you explore the possible use cases!

Thanks for reading :).