import { Sitemap } from "@mongez/sitemap";

const sitemap = new Sitemap("https://home.master3307.org");

sitemap.add("/");
sitemap.add("/card");
sitemap.add("/about");

await sitemap.saveTo("./public/sitemap.xml");