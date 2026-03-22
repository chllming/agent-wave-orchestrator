# AWS Service Verification Patterns

Reference for verifying AWS deployment state per service type.

## ECS (Elastic Container Service)
- Task status: `aws ecs describe-tasks --cluster <cluster> --tasks <task-arn>`
- Service status: `aws ecs describe-services --cluster <cluster> --services <service-name>`
- Key checks: desiredCount == runningCount, no STOPPED tasks with non-zero exit code, deployment in COMPLETED state.
- Logs: `aws logs get-log-events --log-group-name <group> --log-stream-name <stream>`

## Lambda
- Function status: `aws lambda get-function --function-name <name>`
- Invoke test: `aws lambda invoke --function-name <name> --payload '{}' /dev/stdout`
- Key checks: State is Active, LastUpdateStatus is Successful, invoke returns expected status code.

## EC2
- Instance status: `aws ec2 describe-instance-status --instance-ids <id>`
- Key checks: InstanceState is running, SystemStatus and InstanceStatus are ok.
- Connect test: Verify security groups allow expected ports.

## S3
- Bucket verification: `aws s3 ls s3://<bucket>/`
- Key checks: Bucket exists, expected objects are present, ACLs/policies are correct.

## CloudWatch
- Metrics: `aws cloudwatch get-metric-statistics --namespace <ns> --metric-name <metric> --period 300 --statistics Average`
- Alarms: `aws cloudwatch describe-alarms --alarm-names <name>`
- Key checks: No ALARM state, error rate metrics within threshold.

## RDS
- Instance status: `aws rds describe-db-instances --db-instance-identifier <id>`
- Key checks: DBInstanceStatus is available, no pending modifications.

## General Pattern
For any AWS service:
1. Identify the resource ARN or name.
2. Use the describe/get API to verify state.
3. Check for pending operations or degraded status.
4. Record the region, account, and exact command used as evidence.
