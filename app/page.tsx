import { Suspense } from "react";
import { PushScreen } from "@/components/push/PushScreen";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PushScreen />
    </Suspense>
  );
}