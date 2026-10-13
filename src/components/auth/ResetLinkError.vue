<script setup lang="ts">
import CardHeading from '@/components/admin/CardHeading.vue'
import FormError from '@/components/auth/FormError.vue'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { FieldGroup } from '@/components/ui/field'
import { authErrorMessage } from '@/lib/auth-errors'

const props = defineProps<{ code: string | null }>()

const message = authErrorMessage({ code: props.code ?? 'INVALID_TOKEN' })
</script>

<template>
  <Card>
    <CardHeader>
      <CardHeading :level="1">Link nicht mehr gültig</CardHeading>
      <CardDescription>
        Aus Sicherheitsgründen gilt jeder Link nur einmal und nur eine Stunde.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <FieldGroup>
        <FormError :message="message" />
        <Button as="a" href="/admin/forgot-password">
          Neuen Link anfordern
        </Button>
      </FieldGroup>
    </CardContent>
  </Card>
</template>
