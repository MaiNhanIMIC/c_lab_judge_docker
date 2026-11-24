#ifndef UNITY_RUNNER_H
#define UNITY_RUNNER_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <assert.h>

#define TEST_ASSERT_EQUAL_INT(expected, actual) do { \
    long long _exp = (long long)(expected); \
    long long _act = (long long)(actual); \
    if (_exp != _act) { \
        fprintf(stderr, "Expected %lld nhưng nhận được %lld\n", _exp, _act); \
        exit(2); \
    } \
} while (0)

#define TEST_ASSERT_EQUAL(expected, actual) TEST_ASSERT_EQUAL_INT(expected, actual)

#define TEST_ASSERT_EQUAL_DOUBLE(expected, actual) do { \
    double _exp = (double)(expected); \
    double _act = (double)(actual); \
    if (fabs(_exp - _act) > 1e-4) { \
        fprintf(stderr, "Expected %.4f nhưng nhận được %.4f\n", _exp, _act); \
        exit(2); \
    } \
} while (0)

#define TEST_ASSERT_EQUAL_FLOAT(expected, actual) TEST_ASSERT_EQUAL_DOUBLE(expected, actual)

#define TEST_ASSERT_EQUAL_STRING(expected, actual) do { \
    const char* _exp = (const char*)(expected); \
    const char* _act = (const char*)(actual); \
    if (!_exp || !_act || strcmp(_exp, _act) != 0) { \
        fprintf(stderr, "Expected \"%s\" nhưng nhận được \"%s\"\n", _exp ? _exp : "(null)", _act ? _act : "(null)"); \
        exit(2); \
    } \
} while (0)

#define TEST_ASSERT_TRUE(cond) do { \
    if (!(cond)) { \
        fprintf(stderr, "Điều kiện kiểm tra trả về FALSE (mong đợi TRUE)\n"); \
        exit(2); \
    } \
} while (0)

#define TEST_ASSERT_FALSE(cond) do { \
    if ((cond)) { \
        fprintf(stderr, "Điều kiện kiểm tra trả về TRUE (mong đợi FALSE)\n"); \
        exit(2); \
    } \
} while (0)

#endif
