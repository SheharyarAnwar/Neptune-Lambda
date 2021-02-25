import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as lambda from "@aws-cdk/aws-lambda";
import * as apigw from "@aws-cdk/aws-apigateway";
import * as neptune from "@aws-cdk/aws-neptune";
import * as iam from "@aws-cdk/aws-iam";
export class VpcStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    const vpc = new ec2.Vpc(this, "Vpc", {
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Ingress",
          subnetType: ec2.SubnetType.ISOLATED,
        },
      ],
    });
    const securityGroup = new ec2.SecurityGroup(
      this,
      "Security-Group-Neptune",
      {
        vpc: vpc,
        allowAllOutbound: true,
      }
    );
    securityGroup.addIngressRule(securityGroup, ec2.Port.tcp(8182));
    const subnetgroup = new neptune.CfnDBSubnetGroup(this, "Subnet-Group", {
      subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.ISOLATED })
        .subnetIds,
      dbSubnetGroupDescription:
        "I don't like anything but small letters in my name xD",
      dbSubnetGroupName: "neptune-subnet-sherry",
    });

    const cluster = new neptune.CfnDBCluster(this, "Cluster", {
      dbSubnetGroupName: subnetgroup.dbSubnetGroupName,
      // availabilityZones: vpc.availabilityZones,
      vpcSecurityGroupIds: [securityGroup.securityGroupId],
      dbClusterIdentifier: "neptune-db-cluster-identifier",
    });
    cluster.addDependsOn(subnetgroup);
    const db = new neptune.CfnDBInstance(this, "Neptune-DB", {
      dbInstanceClass: "db.t3.medium",
      dbClusterIdentifier: cluster.dbClusterIdentifier,
    });
    db.addDependsOn(cluster);
    const lambdaLayer = new lambda.LayerVersion(
      this,
      "Lambda-Layer-Neptune-Handler",
      {
        code: lambda.Code.fromAsset("lambda-layers"),
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }
    );
    const handler = new lambda.Function(this, "Lambda", {
      runtime: lambda.Runtime.NODEJS_10_X,
      code: new lambda.AssetCode("lambdas"),
      handler: "index.handler",
      layers: [lambdaLayer],
      vpc: vpc,
      securityGroups: [securityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.ISOLATED,
      },
    });
    handler.addEnvironment("NEPTUNE_ENDPOINT", db.attrEndpoint);
    handler.addEnvironment("NEPTUNE_PORT", db.attrPort);
    handler.addEnvironment("USE_IAM", "false");
    new cdk.CfnOutput(this, "Output-Endpoonit", {
      value: db.attrEndpoint,
    });
    new cdk.CfnOutput(this, "Output-Port", {
      value: db.attrPort,
    });
    new cdk.CfnOutput(this, "Use-iam", {
      value: `${cluster.iamAuthEnabled}`,
    });

    const apigateway = new apigw.LambdaRestApi(this, "api", {
      handler: handler,
    });
  }
}
