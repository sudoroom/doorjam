/*
  Lets the arduino be controlled over serial 
  and in turn control the door
*/

int doorControl = 13;

void setup() {
  Serial.begin(9600);
  pinMode(doorControl, OUTPUT);
}

byte input;

int countdown = 0;
void loop() {
  
  if(Serial.available() > 0) {
    input = Serial.read();
    if(input == 'O') {
      digitalWrite(doorControl, HIGH);
      countdown = 50;
    }
  }
  delay(100);
  if(countdown > 0) {
    countdown = countdown - 1;
    if(countdown <= 0) {
      digitalWrite(doorControl, LOW);
    }
  }
}



