import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { tokens } from "@print-automated/design-tokens";
import { instructionSummary } from "@print-automated/api-client";
import type { DashboardJob } from "@print-automated/types";
import { BlockedNote, MUTED, Pills } from "@/components/ui";
import { formatAge, jobBadges } from "@/lib/job-view";

/** One job on the production screen (23.33): the order number and badges, the document, what
 * to load and how to print it, and why it is blocked. Tapping opens the order, whose screen
 * has the job's actions. */
export function JobCard({
  job,
  showPrinter = true,
}: {
  job: DashboardJob;
  showPrinter?: boolean;
}): ReactNode {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Order ${job.publicOrderNumber}, ${job.status.toLowerCase()}`}
      onPress={() => router.push(`/orders/${job.orderId}`)}
      style={styles.card}
    >
      <View style={styles.headerRow}>
        <Text style={styles.orderNumber}>{job.publicOrderNumber}</Text>
        <Text style={styles.age}>{formatAge(job.updatedAt)}</Text>
      </View>
      <Pills badges={jobBadges(job)} />
      {job.documentFilename !== null && (
        <Text numberOfLines={1} style={styles.document}>
          {job.documentFilename}
        </Text>
      )}
      <Text style={styles.instructions}>
        <Text style={styles.instructionsLabel}>Load and print: </Text>
        {instructionSummary(job.instructions)}
      </Text>
      {showPrinter && (
        <Text style={styles.printer}>
          {job.printerName !== null ? `On ${job.printerName}` : "No printer assigned yet"}
        </Text>
      )}
      <BlockedNote reason={job.blockedReason} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: tokens.borders.color,
    borderRadius: tokens.radius.md,
    padding: 14,
    gap: 6,
    backgroundColor: "#fff",
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  orderNumber: { fontWeight: "700", fontSize: 16 },
  age: { color: MUTED, fontSize: 12 },
  document: { fontSize: 14 },
  instructions: { fontSize: 13, color: MUTED },
  instructionsLabel: { fontWeight: "700", color: "#111827" },
  printer: { fontSize: 13, color: MUTED },
});
