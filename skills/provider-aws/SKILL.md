# AWS

<!-- CUSTOMIZE: Add your AWS account IDs, regions, service names, and IAM role ARNs below. -->

## Core Rules

- Name the exact AWS service, account, region, and resource involved.
- Prefer explicit CLI or console-equivalent evidence for deployment and environment state.
- Separate IAM or identity issues from workload health or rollout issues.
- If AWS state is inferred indirectly, mark the proof gap instead of implying live verification.
- Always include the region in verification commands. Do not rely on default region configuration.

## Resource Identification

Every AWS verification must specify:

- **Service type** -- ECS, Lambda, EC2, S3, CloudFront, RDS, DynamoDB, SQS, SNS, etc.
- **Account ID** -- the 12-digit AWS account number.
- **Region** -- the AWS region (e.g., `us-east-1`, `eu-west-1`).
- **Resource identifier** -- ARN, resource name, or resource ID depending on the service.

Do not use shorthand. `the ECS service` is insufficient. `ecs service my-api in cluster prod-cluster, account 123456789012, us-east-1` is correct.

## Verification Procedures

### ECS (Task and Service Status)

```
aws ecs describe-services --cluster <cluster> --services <service> --region <region>
aws ecs list-tasks --cluster <cluster> --service-name <service> --region <region>
aws ecs describe-tasks --cluster <cluster> --tasks <task-arn> --region <region>
```

Confirm: desired count matches running count, last deployment status is PRIMARY and COMPLETED, no tasks in STOPPED state with error exit codes.

### Lambda

```
aws lambda get-function --function-name <name> --region <region>
aws lambda invoke --function-name <name> --payload '{}' /dev/stdout --region <region>
```

Confirm: function exists, runtime is expected version, last modified timestamp is recent if just deployed, invoke returns expected status code.

### EC2

```
aws ec2 describe-instances --instance-ids <id> --region <region>
```

Confirm: instance state is `running`, status checks pass (system and instance), security groups and network configuration match expectations.

### S3

```
aws s3 ls s3://<bucket>/ --region <region>
aws s3api head-bucket --bucket <bucket> --region <region>
```

Confirm: bucket exists, expected objects are present, access permissions are correct.

### CloudWatch Metrics

```
aws cloudwatch get-metric-statistics --namespace <ns> --metric-name <metric> --dimensions <dims> --start-time <start> --end-time <end> --period 300 --statistics Average --region <region>
```

Use for: error rate trends, latency baselines, invocation counts, and health signal confirmation.

<!-- CUSTOMIZE: Add verification procedures for additional AWS services used in your project here. -->

## Evidence Format

When recording AWS verification, use this structure:

```
Service: <aws-service-type>
Resource: <ARN-or-name>
Account: <account-id>
Region: <region>
Verification Command: <exact-command-run>
Result: <summary-of-output>
Status: <healthy|degraded|failed|unknown>
Timestamp Context: <when-verified>
```

Omit fields that were not checked. Do not fill in fields with assumed values.

## IAM vs Workload Issues

These are different failure domains with different owners and different fixes:

### IAM / Identity Failures

- Symptom: `AccessDenied`, `UnauthorizedAccess`, `AssumeRolePolicy` errors.
- Owner: infrastructure role (the agent or team managing IAM policies and roles).
- Fix: policy update, trust relationship change, or role assumption path correction.
- Do not conflate with app health. A Lambda may be healthy but unable to reach S3 due to a missing IAM policy.

### Workload / Application Failures

- Symptom: crash loops, OOM kills, health check failures, timeout errors, application-level error responses.
- Owner: deploy role (the agent or team managing the application code and configuration).
- Fix: code fix, configuration change, resource scaling, or dependency resolution.

When reporting failures, classify which domain the failure belongs to. If both are present, report them as separate issues with separate owners.

## Customization

<!-- CUSTOMIZE: Override or extend any section above. Common additions:
  - AWS account IDs: production=<id>, staging=<id>
  - Primary regions: <comma-separated-list>
  - Service inventory: <service-type> -> <resource-name> -> <region>
  - IAM role ARNs: deploy-role=<arn>, infra-role=<arn>
  - CloudWatch alarm names and thresholds
  - Custom health check endpoints per service
-->
