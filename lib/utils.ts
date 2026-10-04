import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Склеивает условные классы и разрешает конфликты Tailwind: последний выигрывает. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
