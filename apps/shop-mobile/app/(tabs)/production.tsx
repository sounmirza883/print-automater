import type { ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { theme } from "@print-automated/design-tokens";
import { Permission, type DashboardJob } from "@print-automated/types";
import { JobCard } from "@/components/job-card";
import { MONO, ScreenHeader, SectionTitle, StateView, TONES } from "@/components/ui";
import { useShopAuth } from "@/providers/shop-auth-provider";
import { useOperatorDashboard } from "@/lib/use-operator-dashboard";

/** 23.8/23.33, the production floor (PRD 40): the job on my printer now, then what is assigned
 * to me, what is waiting for anyone, what is blocked and why, and what I finished today. Each
 * job shows what to load and how to print it; tapping one opens its order and actions. */
function ProductionBody(): ReactNode {
  const { apiClient, shopId, can } = useShopAuth();
  const allowed = can(Permission.VIEW_OPERATOR_DASHBOARD);
  const { state, reload } = useOperatorDashboard(apiClient, shopId, allowed);

  if (!allowed) {
    return (
      <StateView
        kind="empty"
        icon="lock-closed-outline"
        title="Production view isn't available"
        message="Your role does not include the production view."
      />
    );
  }
  if (state.phase === "loading") {
    return <StateView kind="loading" title="Loading the floor" />;
  }
  if (state.phase === "error") {
    return <StateView kind="error" title="Couldn't load production" message={state.message} />;
  }

  const { data } = state;
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={state.refreshing}
          onRefresh={reload}
          tintColor={theme.brand.accent}
          colors={[theme.brand.accent]}
        />
      }
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.counts}
        style={styles.countsScroll}
      >
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
      </ScrollView>

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
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={[
        styles.count,
        colour !== null && { backgroundColor: colour.bg, borderColor: colour.border },
      ]}
    >
      <Text style={[styles.countValue, colour !== null && { color: colour.fg }]}>{value}</Text>
      <Text style={[styles.countLabel, colour !== null && { color: colour.fg }]}>{label}</Text>
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
        <View style={styles.emptyRow}>
          <Text style={styles.muted}>{empty}</Text>
        </View>
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
  screen: { flex: 1, backgroundColor: theme.surface.background },
  scroll: { flex: 1, backgroundColor: theme.surface.background },
  container: { padding: theme.space.lg, gap: theme.space.xl, paddingBottom: theme.space.xxl },
  muted: { ...theme.type.caption, color: theme.text.muted },
  countsScroll: { flexGrow: 0, marginHorizontal: -theme.space.lg },
  counts: { paddingHorizontal: theme.space.lg, gap: theme.space.sm },
  count: {
    minWidth: 104,
    minHeight: 88,
    borderWidth: 1,
    borderColor: theme.border.default,
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    backgroundColor: theme.surface.card,
    justifyContent: "space-between",
  },
  countValue: {
    fontFamily: MONO,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "700",
    color: theme.text.primary,
  },
  countLabel: { ...theme.type.caption, color: theme.text.muted },
  list: { gap: theme.space.md },
  emptyRow: {
    padding: theme.space.lg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.border.strong,
    alignItems: "center",
  },
});

export default function ProductionScreen(): ReactNode {
  const { shopName } = useShopAuth();
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Production" subtitle={shopName} />
      <ProductionBody />
    </View>
  );
}
