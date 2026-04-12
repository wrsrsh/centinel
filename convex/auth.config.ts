// Tells Convex which JWT issuer to trust. Set CLERK_JWT_ISSUER_DOMAIN in the
// Convex dashboard (it's the "Frontend API URL" from Clerk's Convex integration page).
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
};
