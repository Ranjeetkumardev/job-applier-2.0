import fs from "fs";
import path from "path";

export interface ProfilePersonal {
  fullName: string;
  email: string;
  phone: string;
  currentLocation: string;
  nativePlace: string;
  preferredLocations: string[];
}

export interface ProfileProfessional {
  currentTitle: string;
  preferredRoles: string[];
  totalExperienceYears: number;
  noticePeriodDays: number;
  isServingNotice: boolean;
  lastWorkingDay: string;
  currentCTC: number;
  expectedCTC: number;
  currentCTCLPA: number;
  expectedCTCLPA: number;
  currentCompany: string;
  employmentType: string;
  highestQualification: string;
  degreeSpecialization: string;
  graduationYear: number;
  skills: string[];
}

export interface Profile {
  personal: ProfilePersonal;
  professional: ProfileProfessional;
  resume: { path: string };
  experienceYears: Record<string, string>;
  answers: Record<string, string>;
}

export const loadProfile = (): Profile => {
  const filePath = path.resolve(process.cwd(), "configs", "profile.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as Profile;
};