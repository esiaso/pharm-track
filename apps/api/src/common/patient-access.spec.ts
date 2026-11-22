import { collectPatientIds, MAX_LOGGED_PATIENTS, patientIdsFromRequest } from './patient-access';

describe('patient access log', () => {
  it('finds patient ids in API responses and FHIR references', () => {
    const body = {
      prescription: { patientId: 'PAT-1', items: [{ id: 'x' }] },
      resourceType: 'Bundle',
      entry: [{ resource: { subject: { reference: 'Patient/PAT-2' } } }, { resource: { patient: { reference: 'https://ct/fhir/Patient/PAT-3' } } }],
    };
    expect([...collectPatientIds(body)].sort()).toEqual(['PAT-1', 'PAT-2', 'PAT-3']);
    expect(collectPatientIds({ medicationReference: { reference: 'Medication/1' } }).size).toBe(0);
  });
  it('reads patient ids from the route and query', () => {
    expect(patientIdsFromRequest({ params: { patientId: 'PAT-1' }, query: { subject: 'Patient/PAT-2' } })).toEqual(['PAT-1', 'PAT-2']);
  });
  it('stops collecting just past the cap so the log can mark the response as truncated', () => {
    const many = Array.from({ length: MAX_LOGGED_PATIENTS + 50 }, (_, i) => ({ patientId: `P${i}` }));
    expect(collectPatientIds(many).size).toBe(MAX_LOGGED_PATIENTS + 1);
  });
});
