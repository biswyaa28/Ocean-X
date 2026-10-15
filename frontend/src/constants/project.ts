/**
 * Single source of truth for the product's public name.
 *
 * The dashboard header, the landing page, page metadata and Open Graph tags all
 * read it from here, so renaming the product is one edit in one file rather than
 * a hunt through JSX and metadata exports.
 */
export const PROJECT_NAME = "OceanLens";

/** Team shown in the landing footer. */
export const PROJECT_TEAM = "Doom's Coders";

/** Hackathon attribution shown in the landing footer. */
export const PROJECT_EVENT = "Smart India Hackathon 2026 · SIH26067";

/**
 * Repository link shown in the landing footer.
 *
 * Taken from the clone URL documented in the project README. Correct this one
 * line if the public repository moves — nothing else references it.
 */
export const PROJECT_REPOSITORY_URL = 'https://github.com/ZoroDev0/Ocean-X';

/** One-line statement of what the product is, used on the hero. */
export const PROJECT_TAGLINE =
  "3D ocean model and Argo float visualization for the Bay of Bengal.";