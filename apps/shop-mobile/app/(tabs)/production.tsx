import type { ReactNode } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { tokens } from "@print-automated/design-tokens";
import { Permission, type DashboardJob } from "@print-automated/types";
import { JobCard } from "@/components/job-card";
import { MUTED, SectionTitle, TONES } from "@/components/ui";
import { useShopAuth } from "@/providers/shop-auth-provider";
import { useOperatorDashboard } from "@/lib/use-operator-dashboard";

/** 23.8/23.33, the production floor (PRD 40): the job on my printer now, then what is assigned
 * to me, what is waiting for anyone, what is blocked and why, and what I finished today. Each
 * job shows what to load and how to print it; tapping one opens its order and actions. */
export default function ProductionScreen(): ReactNode {
  const { apiClient, shopId, can } = useShopAuth();
  const allowed = can(Permission.VIEW_OPERATOR_DASHBOARD);
  const { state, reload } = useOperatorDashboard(apiClient, shopId, allowed);

  if (!allowed) {
    return (
      <View style={styles.container}>
        <Text style={styles.muted}>Your role does not include the production view.</Text>
      </View>
    );
  }
  if (state.phase === "loading") {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }
  if (state.phase === "error") {
    return (
      <View style={styles.container}>
        <Text accessibilityRole="alert" style={styles.error}>
          {state.message}
        </Text>
      </View>
    );
  }

  const { data } = state;
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={state.refreshing} onRefresh={reload} />}
    >
      <View style={styles.counts}>
        <Count
          label="On a printer"
          value={data.currentJobs.length}
          tone={data.currentJobs.length > 0 ? "accent" : undefined}
        />
        <Count label="Assigned to me" value={data.myAssigned.total} />
        <Count label="Waiting" value={data.waiting.total} />
        <Count
          label="Blocked"
          value={data.blocked.total}
          tone={data.blocked.total > 0 ? "caution" : undefined}
        />
        <Count label="Done today" value={data.completedToday.total} tone="good" />
      </View>

      <JobList
        title="On a printer now"
        jobs={data.currentJobs}
        total={data.currentJobs.length}
        empty="You have no job on a printer right now."
      />
      <JobList
        title="Assigned to me"
        jobs={data.myAssigned.items}
        total={data.myAssigned.total}
        empty="Nothing is assigned to you."
      />
      <JobList
        title="Waiting for a printer or operator"
        jobs={data.waiting.items}
        total={data.waiting.total}
        empty="No jobs are waiting."
      />
      <JobList
        title="Blocked"
        jobs={data.blocked.items}
        total={data.blocked.total}
        empty="No job is blocked."
      />
      <JobList
        title="Done today"
        jobs={data.completedToday.items}
        total={data.completedToday.total}
        empty="You have not finished a job yet today."
      />
    </ScrollView>
  );
}

function Count({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "accent" | "caution" | "good";
}): ReactNode {
  const colour = tone !== undefined && value > 0 ? TONES[tone] : null;
  return (
    <View
      style={[
        styles.count,
        colour !== null && { backgroundColor: colour.bg, borderColor: colour.border },
      ]}
    >
      <Text style={[styles.countValue, colour !== null && { color: colour.fg }]}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

function JobList({
  title,
  jobs,
  total,
  empty,
}: {
  title: string;
  jobs: DashboardJob[];
  total: number;
  empty: string;
}): ReactNode {
  return (
    <View style={styles.list}>
      <SectionTitle title={title} count={total} />
      {jobs.length === 0 ? (
        <Text style={styles.muted}>{empty}</Text>
      ) : (
        jobs.map((job) => <JobCard key={job.id} job={job} />)
      )}
      {total > jobs.length && (
        <Text style={styles.muted}>
          Showing {jobs.length} of {total}. The rest are in Orders.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#F9FAFB" },
  container: { padding: 16, gap: 12 },
  muted: { color: MUTED },
  error: { color: tokens.colors.error },
  counts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  count: {
    flexGrow: 1,
    minWidth: 96,
    borderWidth: 1,
    borderColor: tokens.borders.color,
    borderRadius: tokens.radius.md,
    padding: 12,
    backgroundColor: "#fff",
    gap: 2,
  },
  countValue: { fontSize: 24, fontWeight: "700", color: "#111827" },
  countLabel: { color: MUTED, fontSize: 13 },
  list: { gap: 8 },
});
