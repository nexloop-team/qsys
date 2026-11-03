import { Lock } from "lucide-react";
import { Notice } from "@/components/card";

export function OwnerOnlyNote() {
  return <Notice icon={<Lock />}>Only the owner can change these.</Notice>;
}
