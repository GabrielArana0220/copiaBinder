/** Response contracts from shared/observability/openapi.yaml. */
export interface CatalogFunction {
  name: string;
  component: string;
  log_group: string;
}

export interface CatalogApplication {
  id: string;
  name?: string;
  functions: CatalogFunction[];
}

export interface CatalogDomain {
  id: string;
  name?: string;
  applications: CatalogApplication[];
}

export interface Catalog {
  domains: CatalogDomain[];
}

export interface Health {
  status: "ok";
  catalog_applications: number;
  selected_log_groups: number;
  logging: {
    detailed: boolean;
    version: number;
  };
  checks: {
    ssm: "available";
    query_registry: "configured";
  };
}
