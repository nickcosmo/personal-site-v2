import { defineCollection, z } from "astro:content";

import { glob, file } from "astro/loaders";

// Blog loader
const blog = defineCollection({
  loader: glob({
    pattern: "**/*.md",
    base: "./src/blog",
  }),
  schema: z.object({
    title: z.string(),
    published: z.date().optional(),
    description: z.string(),
    author: z.string(),
    tags: z.array(z.string()),
    ogImage: z.string().optional(),
  }),
});

export const collections = { blog };
