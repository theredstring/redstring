# 🔧 Cloud Run CPU Configuration Guide

## Valid CPU Values for Cloud Run

Cloud Run only accepts specific CPU values. Invalid values will cause deployment failures.

### Allowed CPU Values
- **0.08** to **1.0** (in 0.01 increments)
- **1.0** (exactly)
- **2.0** (exactly)
- **4.0** (exactly)
- **6.0** (exactly)
- **8.0** (exactly)

### Invalid Values (Will Cause Build Failures)
- ❌ 1.5 (not allowed)
- ❌ 3.0 (not allowed)
- ❌ 5.0 (not allowed)
- ❌ Any other decimal values

## Our Current Configuration

### Production Environment
- **Main App**: 2.0 CPU cores ✅ (valid)
- **OAuth Server**: 1.0 CPU core ✅ (valid)
- **GitHub App OAuth**: 1.0 CPU core ✅ (valid)

### Test Environment
- **Main App**: 1.0 CPU core ✅ (valid)
- **OAuth Server**: 1.0 CPU core ✅ (valid)

## Why This Matters

The error you encountered:
```
ERROR: (gcloud.run.deploy) spec.template.spec.containers[0].resources.limits.cpu: Invalid value specified for container cpu. Must be equal to one of [.08-1], 1.0, 2.0, 4.0, 6.0, 8.0
```

This happened because we initially set test environment to 1.5 CPU cores, which is not a valid Cloud Run value.

## Performance vs Cost Trade-offs

### Budget-Friendly Options
- **0.5 CPU**: Good for development/testing, lower cost
- **1.0 CPU**: Balanced performance/cost for most workloads
- **2.0 CPU**: Better performance for production workloads

### High-Performance Options
- **4.0 CPU**: For high-traffic applications
- **6.0 CPU**: For compute-intensive workloads
- **8.0 CPU**: Maximum performance (highest cost)

## Recommendations

1. **Test Environment**: Use 1.0 CPU (good balance)
2. **Production Environment**: Use 2.0 CPU (better performance)
3. **OAuth Servers**: Use 1.0 CPU (sufficient for auth operations)
4. **Monitor Usage**: Adjust based on actual performance needs

## Cost Impact (per month)

| CPU Cores | Cost Increase |
|-----------|---------------|
| 0.5 → 1.0 | +$1.04/month |
| 1.0 → 2.0 | +$2.07/month |
| 2.0 → 4.0 | +$4.14/month |

---

**Remember**: Always use valid Cloud Run CPU values to avoid deployment failures!





