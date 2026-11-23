/**
 * Contract ↔ database parity: every enum the API writes must be insertable, value for value.
 * Fails the moment @synan/contracts and @synan/db drift apart.
 */
import { describe, expect, it } from "vitest";
import * as E from "@synan/contracts/enums";
import { schema } from "@synan/db";

const pairs: [string, readonly string[], readonly string[]][] = [
  ["AttendeeTier", E.AttendeeTier.options, schema.attendeeTier.enumValues],
  ["Role", E.Role.options, schema.userRole.enumValues],
  ["ScanResult", E.ScanResult.options, schema.scanResult.enumValues],
  ["CredentialState", E.CredentialState.options, schema.credentialState.enumValues],
  ["CarrierState", E.CarrierState.options, schema.carrierState.enumValues],
  ["CarrierKind", E.CarrierKind.options, schema.carrierKind.enumValues],
  ["ChipProfile", E.ChipProfile.options, schema.chipProfile.enumValues],
  ["EventState", E.EventState.options, schema.eventState.enumValues],
  ["AlertKind", E.AlertKind.options, schema.alertKind.enumValues],
  ["AlertState", E.AlertState.options, schema.alertState.enumValues],
  ["Severity", E.Severity.options, schema.alertSeverity.enumValues],
  ["CheckpointDirection", E.CheckpointDirection.options, schema.checkpointDirection.enumValues],
  ["ScanDirection", E.ScanDirection.options, schema.scanDirection.enumValues],
  ["CapacityPolicy", E.CapacityPolicy.options, schema.capacityPolicy.enumValues],
  ["RegistrationState", E.RegistrationState.options, schema.registrationState.enumValues],
  ["InvitationState", E.InvitationState.options, schema.invitationState.enumValues],
  ["AccessSubjectKind", E.AccessSubjectKind.options, schema.accessSubjectKind.enumValues],
  ["AccessEffect", E.AccessEffect.options, schema.accessEffect.enumValues],
  ["OccupancyAdjustmentReason", E.OccupancyAdjustmentReason.options, schema.occupancyAdjustmentReason.enumValues],
  ["SigningKeyPurpose", E.SigningKeyPurpose.options, schema.signingKeyPurpose.enumValues],
  ["ReportKind", E.ReportKind.options, schema.reportKind.enumValues],
  ["ReportState", E.ReportState.options, schema.reportState.enumValues],
];

describe("contracts ↔ @synan/db enum parity", () => {
  it.each(pairs)("%s", (_name, contract, db) => {
    expect([...db]).toEqual([...contract]);
  });
});
