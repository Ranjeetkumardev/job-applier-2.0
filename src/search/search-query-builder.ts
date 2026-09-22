import type { Profile } from "../config/profile.js";

export interface SearchTask {
  roleName: string;
  query: string;
  location: string;
}

export const generateSearchMatrix = (
  profile: Profile,
  locations: string[],
): SearchTask[] => {
  const roles = profile.professional?.preferredRoles ?? [];

  if (roles.length === 0) {
    throw new Error(
      "profile.professional.preferredRoles is empty — add at least one role to configs/profile.json",
    );
  }

  const years = profile.professional.totalExperienceYears ?? 3;

  // Search from the candidate's completed years onward.
  const minExp = Math.max(0, Math.floor(years));
  const maxExp = Math.max(minExp + 1, Math.ceil(years) + 1);

  // Keep each term as a separate search so Naukri ranks exact role matches.
  return roles.flatMap((role) => {
    const queryRole = /\s/.test(role) ? `"${role}"` : role;
    const query = `${queryRole} exp:${minExp}-${maxExp}`;

    return locations.map((location) => ({
      roleName: role,
      query,
      location,
    }));
  });
};
 