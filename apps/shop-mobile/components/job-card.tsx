import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { theme } from "@print-automated/design-tokens";
import { instructionSummary } from "@print-automated/api-client";
import type { DashboardJob } from "@print-automated/types";
import { BlockedNote, Card, MONO, MUTED, Pills, PressableScale } from "@/components/ui";
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
  const edge = job.blockedReason !== null ? theme.tones.caution.solid : theme.brand.accent;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Order ${job.publicOrderNumber}, ${job.status.toLowerCase()}`}
      onPress={() => router.push(`/orders/${job.orderId}`)}
      scaleTo={0.985}
    >
      <Card edge={edge}>
        <View style={styles.headerRow}>
          <Text style={styles.orderNumber}>{job.publicOrderNumber}</Text>
          <View style={styles.ageRow}>
            <Ionicons name="time-outline" size={14} color={MUTED} />
            <Text style={styles.age}>{formatAge(job.updatedAt)}</Text>
          </View>
        </View>
        <Pills badges={jobBadges(job)} />
        {job.documentFilename !== null && (
          <View style={styles.line}>
            <Ionicons name="document-text-outline" size={16} color={MUTED} />
            <Text numberOfLines={1} style={styles.document}>
              {job.documentFilename}
            </Text>
          </View>
        )}
        <View style={styles.instructionBox}>
          <Text style={styles.instructionsLabel}>Load and print</Text>
          <Text style={styles.instructions}>{instructionSummary(job.instructions)}</Text>
        </View>
        {showPrinter && (
          <View style={styles.line}>
            <Ionicons name="print-outline" size={16} color={MUTED} />
            <Text style={styles.printer}>
              {job.printerName !== null ? `On ${job.printerName}` : "No printer assigned yet"}
            </Text>
          </View>
        )}
        <BlockedNote reason={job.blockedReason} />
      </Card>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  orderNumber: { ...theme.type.heading, fontFamily: MONO, fontSize: 16, color: theme.text.primary },
  ageRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  age: { ...theme.type.caption, color: MUTED },
  line: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  document: { ...theme.type.body, flex: 1, color: theme.text.primary },
  instructionBox: {
    backgroundColor: theme.surface.subtle,
    borderRadius: theme.radius.sm,
    padding: theme.space.md,
    gap: 2,
  },
  instructionsLabel: { ...theme.type.overline, color: MUTED, textTransform: "uppercase" },
  instructions: { ...theme.type.bodyStrong, color: theme.text.primary },
  printer: { ...theme.type.caption, color: MUTED },
});
